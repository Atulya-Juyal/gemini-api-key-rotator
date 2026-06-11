import express, { Request, Response } from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import { KeyManager } from './KeyManager';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize the key manager from the environment variable
const rawKeys = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') : [];
let keyManager: KeyManager;

try {
  keyManager = new KeyManager(rawKeys);
  console.log(`[Init] KeyManager initialized with ${rawKeys.length} API keys.`);
} catch (error: any) {
  console.error(`[Init Error] Failed to initialize KeyManager: ${error.message}`);
  process.exit(1);
}

// Middleware
app.use(express.json());

// Monitoring / health check endpoint to check key rotation statuses securely
app.get('/status', (req: Request, res: Response) => {
  const status = keyManager.getStatus().map(meta => ({
    keyPreview: `${meta.key.substring(0, 6)}...${meta.key.slice(-4)}`,
    isCoolingDown: meta.isCoolingDown,
    coolDownUntil: meta.isCoolingDown ? new Date(meta.coolDownUntil).toISOString() : null,
    errorCount: meta.errorCount
  }));
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    keys: status
  });
});

// Omnibus wildcard route handlers to match both v1 and v1beta routes
const wildcardHandler = async (req: Request, res: Response) => {
  const maxRetries = 3;
  let attempt = 0;
  let lastError: any = null;

  // Clone headers and remove host/content-length overrides
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];

  while (attempt <= maxRetries) {
    let leasedKey: string;
    try {
      leasedKey = keyManager.getNextAvailableKey();
    } catch (err: any) {
      console.error(`[Proxy Error] No available keys: ${err.message}`);
      return res.status(503).json({
        error: {
          code: 503,
          message: "Service Unavailable: All API keys are cooling down.",
          status: "UNAVAILABLE"
        }
      });
    }

    const keyPreview = `${leasedKey.substring(0, 6)}...${leasedKey.slice(-4)}`;
    console.log(`[Routing] Attempt ${attempt + 1}: Path ${req.path} using key ${keyPreview}`);

    // Construct the destination URL
    const targetUrl = new URL(`https://generativelanguage.googleapis.com${req.path}`);
    
    // Forward all original query parameters (excluding manual key overrides)
    for (const [qKey, qVal] of Object.entries(req.query)) {
      if (qKey !== 'key') {
        targetUrl.searchParams.set(qKey, String(qVal));
      }
    }
    // Inject the dynamically rotated key
    targetUrl.searchParams.set('key', leasedKey);

    try {
      const response = await axios({
        method: req.method,
        url: targetUrl.toString(),
        headers: headers as any,
        data: req.method !== 'GET' ? req.body : undefined,
        validateStatus: () => true // Allow handling statuses manually without throwing axios errors
      });

      if (response.status === 429) {
        console.warn(`[429 Rate Limit] Key ${keyPreview} triggered rate limiting. Flagging as cooling down.`);
        keyManager.flagRateLimited(leasedKey);
        attempt++;
        continue;
      }

      // Return successful response or non-429 upstream errors directly to the client
      res.status(response.status).set(response.headers).send(response.data);
      return;

    } catch (error: any) {
      console.error(`[Network/Axios Error] Key ${keyPreview} failed: ${error.message}`);
      
      // If error has a response status of 429, flag the key and retry
      if (error.response && error.response.status === 429) {
        console.warn(`[429 Rate Limit] Key ${keyPreview} triggered rate limiting. Flagging as cooling down.`);
        keyManager.flagRateLimited(leasedKey);
        attempt++;
        continue;
      }

      lastError = error;
      attempt++;
    }
  }

  // If we reach here, we've exhausted all retries
  console.error(`[Proxy Exhaustion] Failed to process request after ${maxRetries + 1} attempts.`);
  return res.status(502).json({
    error: {
      code: 502,
      message: `Bad Gateway: Request failed after multiple rotation attempts. Last error: ${lastError?.message || 'Unknown network error'}`,
      status: "BAD_GATEWAY"
    }
  });
};

// Catch all HTTP methods for v1 and v1beta endpoints
app.all('/v1/*', wildcardHandler);
app.all('/v1beta/*', wildcardHandler);

// Start Server
app.listen(PORT, () => {
  console.log(`[Server] Gemini Key Rotation Proxy running on port ${PORT}`);
  
  // Self-pinging routine to prevent sleep/spin-down on Render Free Tier
  const PUBLIC_URL = process.env.PUBLIC_URL;
  if (PUBLIC_URL) {
    const PING_INTERVAL = 10 * 60 * 1000; // 10 minutes
    console.log(`[Pinger] Self-pinging configured for: ${PUBLIC_URL}`);
    
    setInterval(async () => {
      try {
        const pingUrl = `${PUBLIC_URL.replace(/\/$/, '')}/status`;
        console.log(`[Pinger] Pinging self to keep connection active...`);
        const response = await axios.get(pingUrl);
        console.log(`[Pinger] Response Status: ${response.status}`);
      } catch (error: any) {
        console.error(`[Pinger Error] Failed self-ping request: ${error.message}`);
      }
    }, PING_INTERVAL);
  } else {
    console.log(`[Pinger] PUBLIC_URL not specified. Self-pinging is disabled.`);
  }
});
