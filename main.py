import requests
import json
import time

PROXY_URL = "http://localhost:3000"

def check_status():
    print("\n--- Current Proxy Status ---")
    try:
        response = requests.get(f"{PROXY_URL}/status")
        print(json.dumps(response.json(), indent=2))
    except Exception as e:
        print(f"Error fetching status (is the proxy running?): {e}")

def send_test_request():
    print("\n--- Sending Test Generation Request ---")
    headers = {
        "Content-Type": "application/json"
    }
    payload = {
        "contents": [{
            "parts": [{
                "text": "Hello, this is a test request to verify proxy routing."
            }]
        }]
    }
    try:
        # We target the standard Gemini API path through our proxy 
        response = requests.post(
            f"{PROXY_URL}/v1/models/gemini-1.5-flash:generateContent",
            headers=headers,
            json=payload
        )
        print(f"Response Code: {response.status_code}")
        try:
            print("Response Data (Snippet):", json.dumps(response.json(), indent=2)[:300] + "...")
        except Exception:
            print("Response Data:", response.text[:300] + "...")
    except Exception as e:
        print(f"Request failed: {e}")

if __name__ == "__main__":
    print("Gemini API Key Rotation Proxy Verification Tool")
    
    # 1. Show initial status
    check_status()
    
    # 2. Send three requests to trigger and observe round-robin rotation in proxy console
    for i in range(1, 4):
        print(f"\n>> Triggering Request #{i}")
        send_test_request()
        # Fetch status to see updated rotation state
        check_status()
        time.sleep(1)
