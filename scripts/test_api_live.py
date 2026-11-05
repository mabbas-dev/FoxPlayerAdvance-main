import urllib.request
import json
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

BASE_URL = 'https://api.foxplayer.app'

def api_call(path, method='GET', data=None, headers=None):
    url = f"{BASE_URL}{path}"
    req_headers = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}
    if headers:
        req_headers.update(headers)
    
    body = None
    if data is not None:
        body = json.dumps(data).encode('utf-8')
        req_headers['Content-Type'] = 'application/json'
        
    req = urllib.request.Request(url, data=body, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            content = resp.read().decode('utf-8')
            return resp.status, json.loads(content)
    except urllib.error.HTTPError as e:
        content = e.read().decode('utf-8')
        try:
            return e.code, json.loads(content)
        except:
            return e.code, content
    except Exception as e:
        return 0, str(e)

if __name__ == '__main__':
    print("1. Health Check:")
    status, res = api_call('/health')
    print("Status:", status, "Response:", res)

    print("\n2. Device Registration (FOXTEST01):")
    status, res = api_call('/api/devices/register', 'POST', {'device_id': 'FOXTEST01', 'installation_id': 'inst-uuid-12345'})
    print("Status:", status, "Response:", res)

    print("\n3. Subscription Status (FOXTEST01):")
    status, res = api_call('/api/subscription/status?device_id=FOXTEST01')
    print("Status:", status, "Response:", res)

    print("\n4. Add M3U Playlist:")
    status, res = api_call('/api/device/FOXTEST01/playlists', 'POST', {
        'type': 'm3u',
        'playlist_name': 'My Sports IPTV',
        'playlist_url': 'https://example.com/sports.m3u'
    })
    print("Status:", status, "Response:", res)

    print("\n5. Add Xtream Playlist:")
    status, res = api_call('/api/device/FOXTEST01/playlists', 'POST', {
        'type': 'xtream',
        'playlist_name': 'Premium Xtream Server',
        'server_url': 'http://xtream.example.com:8080',
        'username': 'demo_user',
        'password': 'demo_password123'
    })
    print("Status:", status, "Response:", res)

    print("\n6. Get Device Playlists:")
    status, res = api_call('/api/device/FOXTEST01/playlists')
    print("Status:", status, "Response:", res)

    print("\n7. Admin Stats:")
    status, res = api_call('/api/admin/stats', 'GET', headers={'x-admin-key': 'fox_admin_2026'})
    print("Status:", status, "Response:", res)

    print("\n8. Admin Update Trial Duration to 14 days:")
    status, res = api_call('/api/admin/trial-settings', 'POST', {'trial_duration_days': 14, 'trial_enabled': 1}, headers={'x-admin-key': 'fox_admin_2026'})
    print("Status:", status, "Response:", res)

    print("\n9. Web Activation (Activate 1 Year for FOXTEST01):")
    status, res = api_call('/api/subscription/activate', 'POST', {'mac': 'FOXTEST01', 'plan': 'YEAR_1'})
    print("Status:", status, "Response:", res)
