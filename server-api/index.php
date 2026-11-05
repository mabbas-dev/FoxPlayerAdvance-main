<?php
// FOX PLAYER Production REST API Router — PHP 8.2 & MariaDB
declare(strict_types=1);

require_once __DIR__ . '/config.php';

// Global CORS headers
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, x-device-id, x-installation-id, x-app-client, x-admin-key, x-admin-token, x-requested-with');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Clean Request URI
$requestUri = $_SERVER['REQUEST_URI'] ?? '/';
$parsedUrl = parse_url($requestUri);
$path = rtrim($parsedUrl['path'] ?? '/', '/');
if ($path === '') $path = '/';
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

// Allow method override via header or POST _method
if ($method === 'POST') {
    if (isset($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'])) {
        $method = strtoupper($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE']);
    } elseif (isset($_POST['_method'])) {
        $method = strtoupper($_POST['_method']);
    }
}

$db = get_db();
ensure_platform_control_schema($db);

/**
 * Whether this subscription row represents lifetime / forever access.
 */
function subscription_row_is_lifetime(array $sub): bool
{
    $type = strtolower(trim((string)($sub['subscription_type'] ?? '')));
    if (in_array($type, ['forever', 'lifetime', 'permanent'], true)) {
        return true;
    }
    $days = (int)($sub['duration_days'] ?? 0);
    if ($days >= 3650) {
        return true;
    }
    $notes = strtolower((string)($sub['notes'] ?? ''));
    return str_contains($notes, 'lifetime') || str_contains($notes, 'forever');
}

/**
 * Build authoritative subscription payload for app clients.
 */
function build_subscription_payload(array $sub, ?string $deviceId = null, ?string $installationId = null): array
{
    $expiryTime = strtotime(($sub['expires_at'] ?? '') . ' UTC');
    $now = time();
    $statusRaw = strtolower(trim((string)($sub['status'] ?? 'active')));
    $isLifetime = subscription_row_is_lifetime($sub);
    $isActive = ($expiryTime > $now) && ($statusRaw === 'active');
    $daysLeft = $isLifetime ? null : max(0, (int)ceil(($expiryTime - $now) / 86400));
    $durationDays = isset($sub['duration_days']) ? (int)$sub['duration_days'] : null;
    $subType = $sub['subscription_type'] ?? 'trial';

    return [
        'id' => (int)($sub['id'] ?? 0),
        'device_id' => $deviceId ?? ($sub['device_id'] ?? null),
        'installation_id' => $installationId ?? ($sub['installation_id'] ?? null),
        'subscription_type' => $subType,
        'type' => $subType,
        'status' => $isActive ? 'active' : ($statusRaw ?: 'expired'),
        'is_active' => $isActive,
        'is_valid' => $isActive,
        'is_lifetime' => $isLifetime,
        'never_expires' => $isLifetime,
        'duration_days' => $durationDays,
        'remaining_days' => $daysLeft,
        'days_left' => $daysLeft,
        'expires_at' => gmdate('Y-m-d\TH:i:s\Z', $expiryTime),
        'starts_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime(($sub['starts_at'] ?? gmdate('Y-m-d H:i:s')) . ' UTC')),
        'server_time' => gmdate('Y-m-d\TH:i:s\Z'),
        'notes' => $sub['notes'] ?? null,
        'source' => $sub['source'] ?? null,
    ];
}

// -------------------------------------------------------------
// Route: Health Check
// -------------------------------------------------------------
if (($path === '/health' || $path === '/api/health') && $method === 'GET') {
    json_response([
        'success' => true,
        'status' => 'ok',
        'service' => 'FOX PLAYER MySQL REST API',
        'php_version' => PHP_VERSION,
        'timestamp' => gmdate('Y-m-d\TH:i:s\Z')
    ]);
}

// -------------------------------------------------------------
// Route: POST /api/devices/register
// -------------------------------------------------------------
if ($path === '/api/devices/register' && $method === 'POST') {
    $input = get_json_input();
    $deviceId = normalize_device_id($input['device_id'] ?? ($input['deviceId'] ?? ''));
    $installationId = $input['installation_id'] ?? ($input['installationId'] ?? null);
    $macAddress = $input['mac_address'] ?? ($input['mac'] ?? null);
    $androidId = trim((string)($input['android_id'] ?? ($input['androidId'] ?? '')));
    $appVersion = $input['app_version'] ?? '1.0.0';
    $ipAddress = $_SERVER['REMOTE_ADDR'] ?? null;

    if (empty($deviceId)) {
        json_response(['success' => false, 'error' => ['code' => 'INVALID_DEVICE_ID', 'message' => 'Device ID is required.']], 400);
    }

    $validAndroidId = null;
    if (!empty($androidId) && preg_match('/^[a-zA-Z0-9_-]{8,64}$/', $androidId)) {
        $validAndroidId = $androidId;
    }

    // Prevent duplicate device records: If this Android ID already has a registered device record,
    // adopt the canonical identity to preserve data integrity and prevent orphan records.
    if (!empty($validAndroidId)) {
        $devCheck = $db->prepare("SELECT id, device_id, installation_id FROM devices WHERE android_id = ? ORDER BY id DESC LIMIT 1");
        $devCheck->execute([$validAndroidId]);
        $existingDevice = $devCheck->fetch();
        if ($existingDevice && $existingDevice['device_id'] !== $deviceId) {
            $deviceId = $existingDevice['device_id'];
            if (empty($installationId) && !empty($existingDevice['installation_id'])) {
                $installationId = $existingDevice['installation_id'];
            }
        }
    }

    // Insert or update device
    $stmt = $db->prepare("
        INSERT INTO devices (device_id, android_id, mac_address, installation_id, app_version, ip_address, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
            android_id = COALESCE(VALUES(android_id), android_id),
            mac_address = COALESCE(VALUES(mac_address), mac_address),
            installation_id = COALESCE(VALUES(installation_id), installation_id),
            app_version = VALUES(app_version),
            ip_address = VALUES(ip_address),
            last_seen_at = NOW()
    ");
    $stmt->execute([$deviceId, $validAndroidId, $macAddress, $installationId, $appVersion, $ipAddress]);

    // Check subscription settings for default trial days
    $setStmt = $db->query("SELECT trial_enabled, trial_duration_days FROM subscription_settings WHERE id = 1 LIMIT 1");
    $settings = $setStmt->fetch() ?: ['trial_enabled' => 1, 'trial_duration_days' => 7];
    $trialDays = (int)($settings['trial_duration_days'] ?? 7);

    // Check if subscription exists for this device or installation
    $subStmt = $db->prepare("
        SELECT * FROM subscriptions 
        WHERE device_id = ? OR (installation_id IS NOT NULL AND installation_id = ?)
        ORDER BY id DESC LIMIT 1
    ");
    $subStmt->execute([$deviceId, $installationId ?: '']);
    $sub = $subStmt->fetch();

    if (!$sub) {
        // Issue authoritative free trial
        $startsAt = gmdate('Y-m-d H:i:s');
        $expiresAt = gmdate('Y-m-d H:i:s', time() + ($trialDays * 86400));
        $insSub = $db->prepare("
            INSERT INTO subscriptions (installation_id, device_id, subscription_type, status, starts_at, expires_at, duration_days, source, notes)
            VALUES (?, ?, 'trial', 'active', ?, ?, ?, 'auto_trial', 'Default free trial granted upon device registration')
        ");
        $insSub->execute([$installationId, $deviceId, $startsAt, $expiresAt, $trialDays]);

        $sub = [
            'device_id' => $deviceId,
            'installation_id' => $installationId,
            'subscription_type' => 'trial',
            'status' => 'active',
            'starts_at' => $startsAt,
            'expires_at' => $expiresAt,
            'duration_days' => $trialDays,
        ];
    }

    $subPayload = build_subscription_payload($sub, $deviceId, $installationId);
    $isActive = (bool)$subPayload['is_active'];
    $daysLeft = $subPayload['days_left'];

    // Retrieve device id_lock state
    $dCheck = $db->prepare("SELECT id_lock FROM devices WHERE device_id = ? LIMIT 1");
    $dCheck->execute([$deviceId]);
    $devRow = $dCheck->fetch();
    $idLock = (bool)($devRow['id_lock'] ?? false);

    json_response([
        'success' => true,
        'has_subscription' => true,
        'device_id' => $deviceId,
        'installation_id' => $installationId,
        'id_lock' => $idLock,
        'device' => [
            'device_id' => $deviceId,
            'id_lock' => $idLock
        ],
        'status' => $subPayload['status'],
        'is_active' => $isActive,
        'is_valid' => $isActive,
        'is_lifetime' => $subPayload['is_lifetime'],
        'days_left' => $daysLeft,
        'remaining_days' => $daysLeft,
        'expires_at' => $subPayload['expires_at'],
        'starts_at' => $subPayload['starts_at'],
        'server_time' => $subPayload['server_time'],
        'subscription_type' => $subPayload['subscription_type'],
        'type' => $subPayload['type'],
        'duration_days' => $subPayload['duration_days'],
        'subscription' => $subPayload
    ]);
}

// -------------------------------------------------------------
// Route: POST /api/devices/recover (Permanent App ID & Automatic Data Recovery)
// -------------------------------------------------------------
if ($path === '/api/devices/recover' && $method === 'POST') {
    $input = get_json_input();
    $androidId = trim((string)($input['android_id'] ?? ($input['androidId'] ?? '')));
    $appVersion = $input['app_version'] ?? '1.0.0';
    $ipAddress = $_SERVER['REMOTE_ADDR'] ?? null;

    if (empty($androidId) || !preg_match('/^[a-zA-Z0-9_-]{8,64}$/', $androidId)) {
        json_response([
            'success' => false,
            'error' => [
                'code' => 'INVALID_ANDROID_ID',
                'message' => 'Valid Android device identifier is required.'
            ]
        ], 400);
    }

    // Query device by android_id
    $stmt = $db->prepare("SELECT * FROM devices WHERE android_id = ? ORDER BY id DESC LIMIT 1");
    $stmt->execute([$androidId]);
    $devRow = $stmt->fetch();

    if (!$devRow) {
        json_response([
            'success' => true,
            'recovered' => false,
            'message' => 'No device found for this Android ID.'
        ]);
    }

    $canonicalDeviceId = $devRow['device_id'];
    $canonicalInstallationId = $devRow['installation_id'];

    // Update last seen
    $upd = $db->prepare("UPDATE devices SET last_seen_at = NOW(), ip_address = ?, app_version = ? WHERE id = ?");
    $upd->execute([$ipAddress, $appVersion, $devRow['id']]);

    // 1. Authoritative Subscription details
    $subStmt = $db->prepare("
        SELECT * FROM subscriptions 
        WHERE device_id = ? OR (installation_id IS NOT NULL AND installation_id = ?)
        ORDER BY id DESC LIMIT 1
    ");
    $subStmt->execute([$canonicalDeviceId, $canonicalInstallationId ?: '']);
    $sub = $subStmt->fetch();

    $subPayload = null;
    if ($sub) {
        $subPayload = build_subscription_payload($sub, $canonicalDeviceId, $canonicalInstallationId);
    }

    // 2. Playlists with decrypted credentials
    $plStmt = $db->prepare("
        SELECT dp.id as device_playlist_id, dp.playlist_id, dp.playlist_name, dp.is_active, dp.enabled,
               p.type, p.playlist_url, p.server_url, p.username, p.password_encrypted
        FROM device_playlists dp
        JOIN playlists p ON p.id = dp.playlist_id
        WHERE dp.device_id = ?
        ORDER BY dp.is_active DESC, dp.id ASC
    ");
    $plStmt->execute([$canonicalDeviceId]);
    $plRows = $plStmt->fetchAll();

    $playlists = [];
    $hasActive = false;
    foreach ($plRows as $r) {
        $isActive = (bool)$r['is_active'];
        if ($isActive) $hasActive = true;
        $playlists[] = [
            'id' => (int)$r['playlist_id'],
            'playlist_id' => (int)$r['playlist_id'],
            'device_playlist_id' => (int)$r['device_playlist_id'],
            'type' => $r['type'],
            'playlist_name' => $r['playlist_name'],
            'name' => $r['playlist_name'],
            'playlist_url' => $r['playlist_url'],
            'playlistUrl' => $r['playlist_url'],
            'server_url' => $r['server_url'],
            'serverUrl' => $r['server_url'],
            'username' => $r['username'],
            'password' => decrypt_secret($r['password_encrypted']),
            'is_active' => $isActive,
            'enabled' => (bool)$r['enabled']
        ];
    }

    if (count($playlists) > 0 && !$hasActive) {
        $playlists[0]['is_active'] = true;
    }

    $encryptedPlaylists = encrypt_payload($playlists);
    $safePlaylists = array_map(function($p) {
        unset($p['password']);
        return $p;
    }, $playlists);

    // 3. User Data (Favorites, settings, preferences)
    $udStmt = $db->prepare("SELECT data_key, data_value FROM device_user_data WHERE device_id = ?");
    $udStmt->execute([$canonicalDeviceId]);
    $udRows = $udStmt->fetchAll();
    $userData = [];
    foreach ($udRows as $ud) {
        $dec = json_decode($ud['data_value'], true);
        $userData[$ud['data_key']] = ($dec !== null) ? $dec : $ud['data_value'];
    }
    $encryptedUserData = encrypt_payload($userData);

    json_response([
        'success' => true,
        'recovered' => true,
        'device_id' => $canonicalDeviceId,
        'installation_id' => $canonicalInstallationId,
        'android_id' => $androidId,
        'id_lock' => (bool)$devRow['id_lock'],
        'has_subscription' => (bool)$subPayload,
        'subscription' => $subPayload,
        'playlists_count' => count($playlists),
        'encrypted_playlists' => $encryptedPlaylists,
        'encrypted_user_data' => $encryptedUserData,
        'playlists' => $safePlaylists,
        'user_data' => $userData,
        'server_time' => gmdate('Y-m-d\TH:i:s\Z')
    ]);
}

// -------------------------------------------------------------
// Route: GET /api/subscription/status
// -------------------------------------------------------------
if ($path === '/api/subscription/status' && $method === 'GET') {
    $deviceId = normalize_device_id($_GET['device_id'] ?? ($_GET['deviceId'] ?? ''));
    $installationId = $_GET['installation_id'] ?? ($_GET['installationId'] ?? null);

    if (empty($deviceId) && empty($installationId)) {
        json_response(['success' => false, 'error' => ['code' => 'MISSING_PARAM', 'message' => 'device_id or installation_id required.']], 400);
    }

    $stmt = $db->prepare("
        SELECT s.*, d.id_lock, d.mac_address 
        FROM subscriptions s
        LEFT JOIN devices d ON d.device_id = s.device_id
        WHERE s.device_id = ? OR (s.installation_id IS NOT NULL AND s.installation_id = ?)
        ORDER BY s.id DESC LIMIT 1
    ");
    $stmt->execute([$deviceId, $installationId ?: '']);
    $sub = $stmt->fetch();

    if (!$sub) {
        json_response([
            'success' => true,
            'configured' => false,
            'has_subscription' => false,
            'status' => 'not_found',
            'is_active' => false,
            'is_valid' => false,
            'days_left' => 0,
            'remaining_days' => 0
        ]);
    }

    $subPayload = build_subscription_payload($sub, $sub['device_id'], $sub['installation_id'] ?? null);

    json_response([
        'success' => true,
        'has_subscription' => true,
        'subscription' => $subPayload,
        'device_id' => $sub['device_id'],
        'subscription_type' => $subPayload['subscription_type'],
        'type' => $subPayload['type'],
        'status' => $subPayload['status'],
        'is_active' => $subPayload['is_active'],
        'is_valid' => $subPayload['is_valid'],
        'is_lifetime' => $subPayload['is_lifetime'],
        'duration_days' => $subPayload['duration_days'],
        'days_left' => $subPayload['days_left'],
        'remaining_days' => $subPayload['remaining_days'],
        'expires_at' => $subPayload['expires_at'],
        'starts_at' => $subPayload['starts_at'],
        'server_time' => $subPayload['server_time'],
        'id_lock' => (bool)($sub['id_lock'] ?? false)
    ]);
}

// -------------------------------------------------------------
// Route: GET /api/subscription/eligibility
// -------------------------------------------------------------
if ($path === '/api/subscription/eligibility' && $method === 'GET') {
    $deviceId = normalize_device_id($_GET['device_id'] ?? '');
    $installationId = $_GET['installation_id'] ?? '';

    $stmt = $db->prepare("
        SELECT id FROM subscriptions 
        WHERE device_id = ? OR (installation_id IS NOT NULL AND installation_id = ?)
        LIMIT 1
    ");
    $stmt->execute([$deviceId, $installationId]);
    $exists = $stmt->fetch();

    $setStmt = $db->query("SELECT trial_enabled, trial_duration_days FROM subscription_settings WHERE id = 1 LIMIT 1");
    $settings = $setStmt->fetch() ?: ['trial_enabled' => 1, 'trial_duration_days' => 7];

    json_response([
        'success' => true,
        'eligible' => empty($exists) && ((int)$settings['trial_enabled'] === 1),
        'trial_duration_days' => (int)$settings['trial_duration_days']
    ]);
}

// -------------------------------------------------------------
// Route: POST /api/subscription/activate-trial
// -------------------------------------------------------------
if ($path === '/api/subscription/activate-trial' && $method === 'POST') {
    $input = get_json_input();
    $deviceId = normalize_device_id($input['device_id'] ?? '');
    $installationId = $input['installation_id'] ?? null;

    if (empty($deviceId)) {
        json_response(['success' => false, 'error' => ['code' => 'INVALID_DEVICE_ID', 'message' => 'device_id required.']], 400);
    }

    $setStmt = $db->query("SELECT trial_enabled, trial_duration_days FROM subscription_settings WHERE id = 1 LIMIT 1");
    $settings = $setStmt->fetch() ?: ['trial_enabled' => 1, 'trial_duration_days' => 7];
    $trialDays = (int)($settings['trial_duration_days'] ?? 7);

    $startsAt = gmdate('Y-m-d H:i:s');
    $expiresAt = gmdate('Y-m-d H:i:s', time() + ($trialDays * 86400));

    $ins = $db->prepare("
        INSERT INTO subscriptions (installation_id, device_id, subscription_type, status, starts_at, expires_at, duration_days, source, notes)
        VALUES (?, ?, 'trial', 'active', ?, ?, ?, 'manual_trial', 'Free trial activated')
        ON DUPLICATE KEY UPDATE
            status = 'active',
            expires_at = VALUES(expires_at),
            updated_at = NOW()
    ");
    $ins->execute([$installationId, $deviceId, $startsAt, $expiresAt, $trialDays]);

    json_response([
        'success' => true,
        'message' => 'Free trial activated successfully.',
        'trial_duration_days' => $trialDays,
        'expires_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime($expiresAt . ' UTC'))
    ]);
}

// -------------------------------------------------------------
// Route: POST /api/subscription/activate (For 1 Year / Forever Web Activation)
// -------------------------------------------------------------
if ($path === '/api/subscription/activate' && $method === 'POST') {
    $input = get_json_input();
    $macOrDevice = normalize_device_id($input['mac'] ?? ($input['device_id'] ?? ''));
    $plan = strtoupper(trim($input['plan'] ?? 'YEAR_1')); // YEAR_1 or FOREVER

    if (empty($macOrDevice)) {
        json_response(['success' => false, 'error' => ['code' => 'INVALID_MAC', 'message' => 'MAC address or Device ID is required.']], 400);
    }

    // Ensure device exists and was registered by the application
    $devCheck = $db->prepare("SELECT id, device_id, id_lock FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1");
    $devCheck->execute([$macOrDevice, $macOrDevice]);
    $dev = $devCheck->fetch();

    if (!$dev) {
        json_response([
            'success' => false,
            'error' => [
                'code' => 'DEVICE_NOT_FOUND',
                'message' => 'Device ID not found in FOX PLAYER system. Please open FOX PLAYER app on your TV or streaming device first to generate and register your Device ID before activating.'
            ]
        ], 404);
    }
    $deviceId = $dev['device_id'];

    $durationDays = ($plan === 'FOREVER') ? 18250 : 365; // ~50 years or 1 year
    $subType = ($plan === 'FOREVER') ? 'forever' : 'year_1';
    $startsAt = gmdate('Y-m-d H:i:s');
    $expiresAt = gmdate('Y-m-d H:i:s', time() + ($durationDays * 86400));

    // Update or insert subscription
    $subStmt = $db->prepare("SELECT id FROM subscriptions WHERE device_id = ? LIMIT 1");
    $subStmt->execute([$deviceId]);
    $existing = $subStmt->fetch();

    if ($existing) {
        $upd = $db->prepare("
            UPDATE subscriptions 
            SET subscription_type = ?, status = 'active', starts_at = ?, expires_at = ?, duration_days = ?, source = 'portal_activation', updated_at = NOW()
            WHERE id = ?
        ");
        $upd->execute([$subType, $startsAt, $expiresAt, $durationDays, $existing['id']]);
    } else {
        $ins = $db->prepare("
            INSERT INTO subscriptions (device_id, subscription_type, status, starts_at, expires_at, duration_days, source, notes)
            VALUES (?, ?, 'active', ?, ?, ?, 'portal_activation', 'Web portal activation')
        ");
        $ins->execute([$deviceId, $subType, $startsAt, $expiresAt, $durationDays]);
    }

    // Audit log
    $audit = $db->prepare("INSERT INTO subscription_audit_logs (action, target_type, target_id, performed_by, details) VALUES ('web_activation', 'device', ?, 'user_portal', ?)");
    $audit->execute([$deviceId, json_encode(['plan' => $plan, 'expires_at' => $expiresAt])]);

    json_response([
        'success' => true,
        'message' => 'Your MAC address / Device is activated successfully! Please restart the FOX PLAYER app.',
        'device_id' => $deviceId,
        'plan' => $subType,
        'status' => 'active',
        'expires_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime($expiresAt . ' UTC')),
        'days_left' => $durationDays
    ]);
}

// -------------------------------------------------------------
// Route: GET /api/device/{deviceId}/validate (Verify device generated by app)
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/validate$#', $path, $matches) && $method === 'GET') {
    $rawId = $matches[1];
    $deviceId = normalize_device_id($rawId);

    $stmt = $db->prepare("
        SELECT id, device_id, mac_address, installation_id, id_lock, status, app_version, created_at, last_seen_at
        FROM devices 
        WHERE device_id = ? OR mac_address = ? 
        LIMIT 1
    ");
    $stmt->execute([$deviceId, $deviceId]);
    $row = $stmt->fetch();

    if (!$row) {
        json_response([
            'success' => false,
            'registered' => false,
            'device_id' => $deviceId,
            'error' => [
                'code' => 'DEVICE_NOT_FOUND',
                'message' => 'Device ID not found in FOX PLAYER system. Please open FOX PLAYER app on your TV or device first so your Device ID is generated and registered.'
            ]
        ], 404);
    }

    json_response([
        'success' => true,
        'registered' => true,
        'device_id' => $row['device_id'],
        'mac_address' => $row['mac_address'],
        'id_lock' => (bool)$row['id_lock'],
        'status' => $row['status'],
        'app_version' => $row['app_version'],
        'created_at' => $row['created_at'],
        'last_seen_at' => $row['last_seen_at']
    ]);
}

// -------------------------------------------------------------
// Route: GET /api/device/{deviceId}/playlists
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/playlists$#', $path, $matches) && $method === 'GET') {
    $deviceId = normalize_device_id($matches[1]);

    // Check device existence
    $devCheck = $db->prepare("SELECT id, device_id, id_lock FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1");
    $devCheck->execute([$deviceId, $deviceId]);
    $devRow = $devCheck->fetch();

    if (!$devRow) {
        json_response([
            'success' => false,
            'error' => [
                'code' => 'DEVICE_NOT_FOUND',
                'message' => 'Device not found. Please open FOX PLAYER app on your TV or device first to register this ID.'
            ]
        ], 404);
    }
    $canonicalDeviceId = $devRow['device_id'];

    $stmt = $db->prepare("
        SELECT dp.id as device_playlist_id, dp.playlist_id, dp.playlist_name, dp.is_active, dp.enabled,
               p.type, p.playlist_url, p.server_url, p.username, p.password_encrypted
        FROM device_playlists dp
        JOIN playlists p ON p.id = dp.playlist_id
        WHERE dp.device_id = ?
        ORDER BY dp.is_active DESC, dp.id ASC
    ");
    $stmt->execute([$canonicalDeviceId]);
    $rows = $stmt->fetchAll();

    $playlists = [];
    $hasActive = false;
    foreach ($rows as $r) {
        $isActive = (bool)$r['is_active'];
        if ($isActive) $hasActive = true;
        $playlists[] = [
            'id' => (int)$r['playlist_id'],
            'playlist_id' => (int)$r['playlist_id'],
            'device_playlist_id' => (int)$r['device_playlist_id'],
            'type' => $r['type'],
            'playlist_name' => $r['playlist_name'],
            'name' => $r['playlist_name'],
            'playlist_url' => $r['playlist_url'],
            'playlistUrl' => $r['playlist_url'],
            'server_url' => $r['server_url'],
            'serverUrl' => $r['server_url'],
            'username' => $r['username'],
            'password' => decrypt_secret($r['password_encrypted']),
            'is_active' => $isActive,
            'enabled' => (bool)$r['enabled']
        ];
    }

    // If exactly one playlist exists or none marked active, activate the first one automatically
    if (count($playlists) > 0 && !$hasActive) {
        $playlists[0]['is_active'] = true;
        $db->prepare("UPDATE device_playlists SET is_active = 1 WHERE device_id = ? AND playlist_id = ? LIMIT 1")
           ->execute([$canonicalDeviceId, $playlists[0]['id']]);
    }

    $encryptedData = encrypt_payload($playlists);

    // Completely redact plaintext passwords from unencrypted playlists representation
    $safePlaylists = array_map(function($p) {
        unset($p['password']);
        return $p;
    }, $playlists);

    json_response([
        'success' => true,
        'device_id' => $canonicalDeviceId,
        'id_lock' => (bool)$devRow['id_lock'],
        'count' => count($playlists),
        'encrypted' => true,
        'data' => $encryptedData,
        'playlists' => $safePlaylists
    ]);
}

// -------------------------------------------------------------
// Route: GET /api/device/{deviceId}/xtream — proxy Xtream API (server-side HTTP to IPTV host)
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/xtream$#', $path, $matches) && $method === 'GET') {
    $deviceId = normalize_device_id($matches[1]);
    $playlistId = (int)($_GET['playlist_id'] ?? 0);
    $action = preg_replace('/[^a-z0-9_]/i', '', (string)($_GET['action'] ?? ''));

    if ($playlistId <= 0 || $action === '') {
        json_response([
            'success' => false,
            'error' => ['code' => 'INVALID_REQUEST', 'message' => 'playlist_id and action are required.'],
        ], 400);
    }

    $stmt = $db->prepare("
        SELECT dp.playlist_id, p.type, p.server_url, p.username, p.password_encrypted
        FROM device_playlists dp
        JOIN playlists p ON p.id = dp.playlist_id
        WHERE dp.device_id = ? AND dp.playlist_id = ?
        LIMIT 1
    ");
    $stmt->execute([$deviceId, $playlistId]);
    $r = $stmt->fetch();

    if (!$r) {
        json_response([
            'success' => false,
            'error' => ['code' => 'PLAYLIST_NOT_FOUND', 'message' => 'Playlist not found for this device.'],
        ], 404);
    }

    $pw = decrypt_secret($r['password_encrypted']);
    $serverUrl = trim((string)($r['server_url'] ?? ''));
    $username = trim((string)($r['username'] ?? ''));

    if ($serverUrl === '' || $username === '' || $pw === '') {
        json_response([
            'success' => false,
            'error' => ['code' => 'INCOMPLETE_CONFIG', 'message' => 'Xtream credentials are incomplete.'],
        ], 400);
    }

    if (!preg_match('#^https?://#i', $serverUrl)) {
        $serverUrl = 'http://' . $serverUrl;
    }
    $serverUrl = preg_replace('#/player_api\.php(\?.*)?$#i', '', $serverUrl);
    $serverUrl = rtrim($serverUrl, '/');

    $extra = '';
    foreach ($_GET as $key => $val) {
        if (in_array($key, ['playlist_id', 'action'], true)) {
            continue;
        }
        if (!is_scalar($val)) {
            continue;
        }
        $safeKey = preg_replace('/[^a-z0-9_]/i', '', (string)$key);
        if ($safeKey === '') {
            continue;
        }
        $extra .= '&' . $safeKey . '=' . rawurlencode((string)$val);
    }

    $providerUrl = $serverUrl . '/player_api.php?username=' . rawurlencode($username)
        . '&password=' . rawurlencode($pw)
        . '&action=' . rawurlencode($action)
        . $extra;

    $ch = curl_init($providerUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 20,
        CURLOPT_TIMEOUT => 90,
        CURLOPT_HTTPHEADER => [
            'User-Agent: IPTVSmartersPro/3.1.5 (Linux; Android 12)',
            'Accept: application/json, text/plain, */*',
        ],
    ]);
    $body = curl_exec($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);

    $authHttpCodes = [401, 403, 511, 512, 513, 514, 515];
    if (in_array($httpCode, $authHttpCodes, true) || ($body !== false && trim((string)$body) === '' && $httpCode >= 400)) {
        json_response([
            'success' => false,
            'error' => [
                'code' => 'IPTV_AUTH_FAILED',
                'message' => 'IPTV authentication failed. Check server URL, username, and password.',
            ],
        ], 401);
    }

    if ($body === false || $httpCode < 200 || $httpCode >= 500) {
        json_response([
            'success' => false,
            'error' => [
                'code' => 'PROVIDER_UNREACHABLE',
                'message' => $curlErr !== '' ? $curlErr : ('Xtream provider returned HTTP ' . $httpCode),
            ],
        ], 502);
    }

    $decoded = json_decode($body, true);
    if ($decoded === null && json_last_error() !== JSON_ERROR_NONE) {
        json_response([
            'success' => false,
            'error' => ['code' => 'INVALID_PROVIDER_RESPONSE', 'message' => 'Provider returned invalid JSON.'],
        ], 502);
    }

    json_response([
        'success' => true,
        'data' => $decoded !== null ? $decoded : $body,
    ]);
}

// -------------------------------------------------------------
// Route: GET /api/device/{deviceId}/playlist (Active or specific config)
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/playlist$#', $path, $matches) && $method === 'GET') {
    $deviceId = normalize_device_id($matches[1]);
    $playlistId = isset($_GET['playlist_id']) ? (int)$_GET['playlist_id'] : null;

    $devCheck = $db->prepare("SELECT id, device_id, id_lock FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1");
    $devCheck->execute([$deviceId, $deviceId]);
    $devRow = $devCheck->fetch();

    if (!$devRow) {
        json_response([
            'success' => false,
            'error' => [
                'code' => 'DEVICE_NOT_FOUND',
                'message' => 'Device not found. Please open FOX PLAYER app on your TV or device first to register this ID.',
            ],
        ], 404);
    }
    $canonicalDeviceId = $devRow['device_id'];

    if ($playlistId) {
        $stmt = $db->prepare("
            SELECT dp.playlist_id, dp.playlist_name, dp.is_active, dp.enabled,
                   p.type, p.playlist_url, p.server_url, p.username, p.password_encrypted
            FROM device_playlists dp
            JOIN playlists p ON p.id = dp.playlist_id
            WHERE dp.device_id = ? AND dp.playlist_id = ?
            LIMIT 1
        ");
        $stmt->execute([$canonicalDeviceId, $playlistId]);
    } else {
        $stmt = $db->prepare("
            SELECT dp.playlist_id, dp.playlist_name, dp.is_active, dp.enabled,
                   p.type, p.playlist_url, p.server_url, p.username, p.password_encrypted
            FROM device_playlists dp
            JOIN playlists p ON p.id = dp.playlist_id
            WHERE dp.device_id = ? AND dp.is_active = 1
            LIMIT 1
        ");
        $stmt->execute([$canonicalDeviceId]);
    }

    $r = $stmt->fetch();
    if (!$r) {
        // Fallback to first available playlist for this device
        $fallback = $db->prepare("
            SELECT dp.playlist_id, dp.playlist_name, dp.is_active, dp.enabled,
                   p.type, p.playlist_url, p.server_url, p.username, p.password_encrypted
            FROM device_playlists dp
            JOIN playlists p ON p.id = dp.playlist_id
            WHERE dp.device_id = ?
            ORDER BY dp.id ASC LIMIT 1
        ");
        $fallback->execute([$canonicalDeviceId]);
        $r = $fallback->fetch();
    }

    if (!$r) {
        json_response([
            'success' => true,
            'configured' => false,
            'device_id' => $canonicalDeviceId,
            'message' => 'No playlists configured for this device.'
        ]);
    }

    $pw = decrypt_secret($r['password_encrypted']);
    $configPayload = [
        'id' => (int)$r['playlist_id'],
        'playlist_id' => (int)$r['playlist_id'],
        'type' => $r['type'],
        'playlist_name' => $r['playlist_name'],
        'name' => $r['playlist_name'],
        'playlist_url' => $r['playlist_url'],
        'playlistUrl' => $r['playlist_url'],
        'server_url' => $r['server_url'],
        'serverUrl' => $r['server_url'],
        'username' => $r['username'],
        'password' => $pw,
        'is_active' => (bool)$r['is_active'],
        'enabled' => (bool)($r['enabled'] ?? true)
    ];

    $encryptedPayload = encrypt_payload($configPayload);

    json_response([
        'success' => true,
        'configured' => true,
        'device_id' => $deviceId,
        'encrypted' => true,
        'data' => $encryptedPayload
    ]);
}

// -------------------------------------------------------------
// Route: POST /api/device/{deviceId}/playlists (Add Playlist)
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/playlists$#', $path, $matches) && $method === 'POST') {
    $deviceId = normalize_device_id($matches[1]);
    $input = get_json_input();

    $typeRaw = strtolower(trim($input['type'] ?? 'm3u'));
    $name = trim($input['playlist_name'] ?? ($input['name'] ?? 'My Playlist'));
    $playlistUrl = trim($input['playlist_url'] ?? ($input['url'] ?? ''));
    $serverUrl = trim($input['server_url'] ?? ($input['host'] ?? ''));
    $username = trim($input['username'] ?? '');
    $password = trim($input['password'] ?? '');

    if ($serverUrl !== '') {
        if (!preg_match('#^https?://#i', $serverUrl)) {
            $serverUrl = 'http://' . $serverUrl;
        }
        $serverUrl = preg_replace('#/player_api\.php(\?.*)?$#i', '', $serverUrl);
        $serverUrl = preg_replace('#/get\.php(\?.*)?$#i', '', $serverUrl);
        $serverUrl = preg_replace('#/c/?$#i', '', $serverUrl);
        $serverUrl = rtrim($serverUrl, '/');
    }

    $type = 'm3u';
    if ($typeRaw === 'xtream' || str_contains($typeRaw, 'xtream') || str_contains($typeRaw, 'trex') || str_contains($typeRaw, 'xstream')) {
        $type = 'xtream';
    } elseif ($typeRaw === 'm3u' || $typeRaw === 'm3u8' || $typeRaw === 'hls') {
        $type = 'm3u';
    } elseif ($serverUrl !== '' && $username !== '' && $password !== '') {
        $type = 'xtream';
    } elseif ($playlistUrl !== '' && (str_contains($playlistUrl, 'username=') || str_contains($playlistUrl, '/playlist/'))) {
        $type = 'xtream';
    }

    if ($type === 'xtream' && $serverUrl === '' && $playlistUrl !== '') {
        $parsed = parse_url($playlistUrl);
        if (is_array($parsed) && !empty($parsed['scheme']) && !empty($parsed['host'])) {
            $port = isset($parsed['port']) ? ':' . $parsed['port'] : '';
            $serverUrl = $parsed['scheme'] . '://' . $parsed['host'] . $port;
        }
        if ($username === '' && !empty($parsed['query'])) {
            parse_str($parsed['query'], $queryParts);
            $username = trim((string)($queryParts['username'] ?? ($queryParts['user'] ?? '')));
            $password = trim((string)($queryParts['password'] ?? ($queryParts['pass'] ?? '')));
        }
    }

    // Verify device exists and was registered by FOX PLAYER app
    $devCheck = $db->prepare("SELECT id, device_id, id_lock FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1");
    $devCheck->execute([$deviceId, $deviceId]);
    $devRow = $devCheck->fetch();

    if (!$devRow) {
        json_response([
            'success' => false,
            'error' => [
                'code' => 'DEVICE_NOT_FOUND',
                'message' => 'Device ID not found in FOX PLAYER network. Please open the FOX PLAYER app on your TV or mobile device first so your Device ID is generated and registered.'
            ]
        ], 404);
    }

    // Check device lock
    if ((int)$devRow['id_lock'] === 1) {
        json_response([
            'success' => false,
            'error' => [
                'code' => 'DEVICE_LOCKED',
                'message' => 'Device is Locked! This device has been locked in FOX PLAYER app settings. Please unlock it from the app first before adding or modifying playlists.'
            ]
        ], 403);
    }

    $canonicalDeviceId = $devRow['device_id'];

    // Update last seen
    $db->prepare("UPDATE devices SET last_seen_at = NOW() WHERE id = ?")->execute([$devRow['id']]);

    // Check if playlist exists or insert
    $pwEncrypted = encrypt_secret($password);
    $playlistId = null;

    if ($type === 'xtream') {
        $pFind = $db->prepare("SELECT id, server_url FROM playlists WHERE type = 'xtream' AND username = ?");
        $pFind->execute([$username]);
        $compareUrl = normalize_server_url_compare($serverUrl);
        while ($rowP = $pFind->fetch()) {
            if (normalize_server_url_compare((string)($rowP['server_url'] ?? '')) === $compareUrl) {
                $playlistId = (int)$rowP['id'];
                $db->prepare("UPDATE playlists SET server_url = ?, password_encrypted = ?, updated_at = NOW() WHERE id = ?")
                   ->execute([$serverUrl, $pwEncrypted, $playlistId]);
                break;
            }
        }
    } else {
        $pFind = $db->prepare("SELECT id FROM playlists WHERE type = 'm3u' AND playlist_url = ? LIMIT 1");
        $pFind->execute([$playlistUrl]);
        $rowP = $pFind->fetch();
        if ($rowP) $playlistId = (int)$rowP['id'];
    }

    if (!$playlistId) {
        $pIns = $db->prepare("
            INSERT INTO playlists (type, playlist_url, server_url, username, password_encrypted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NOW(), NOW())
        ");
        $pIns->execute([$type, $playlistUrl ?: null, $serverUrl ?: null, $username ?: null, $pwEncrypted ?: null]);
        $playlistId = (int)$db->lastInsertId();
    }

    // Check how many playlists exist for this device. If 0, make this active.
    $cntStmt = $db->prepare("SELECT COUNT(*) FROM device_playlists WHERE device_id = ?");
    $cntStmt->execute([$canonicalDeviceId]);
    $count = (int)$cntStmt->fetchColumn();
    $isActive = ($count === 0) ? 1 : 0;

    $dpIns = $db->prepare("
        INSERT INTO device_playlists (device_id, playlist_id, playlist_name, is_active, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
            playlist_name = VALUES(playlist_name),
            enabled = 1,
            updated_at = NOW()
    ");
    $dpIns->execute([$canonicalDeviceId, $playlistId, $name, $isActive]);

    json_response([
        'success' => true,
        'message' => 'Playlist added successfully. Please reload playlist in your FOX PLAYER app.',
        'playlist_id' => $playlistId,
        'device_id' => $canonicalDeviceId,
        'is_active' => (bool)$isActive
    ]);
}

// -------------------------------------------------------------
// Route: POST /api/device/{deviceId}/active-playlist
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/active-playlist$#', $path, $matches) && $method === 'POST') {
    $deviceId = normalize_device_id($matches[1]);
    $input = get_json_input();
    $playlistId = (int)($input['playlist_id'] ?? 0);

    if ($playlistId <= 0) {
        json_response(['success' => false, 'error' => ['code' => 'INVALID_PARAM', 'message' => 'playlist_id is required.']], 400);
    }

    // Check device existence & lock
    $devCheck = $db->prepare("SELECT id, device_id, id_lock FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1");
    $devCheck->execute([$deviceId, $deviceId]);
    $devRow = $devCheck->fetch();

    if (!$devRow) {
        json_response(['success' => false, 'error' => ['code' => 'DEVICE_NOT_FOUND', 'message' => 'Device not found.']], 404);
    }
    if ((int)$devRow['id_lock'] === 1) {
        json_response(['success' => false, 'error' => ['code' => 'DEVICE_LOCKED', 'message' => 'Device is Locked! This device has been locked in FOX PLAYER app settings. Please unlock it from the app first before modifying playlists.']], 403);
    }
    $canonicalDeviceId = $devRow['device_id'];

    // Set all to 0, then set target to 1
    $db->prepare("UPDATE device_playlists SET is_active = 0 WHERE device_id = ?")->execute([$canonicalDeviceId]);
    $stmt = $db->prepare("UPDATE device_playlists SET is_active = 1, last_used_at = NOW() WHERE device_id = ? AND playlist_id = ?");
    $stmt->execute([$canonicalDeviceId, $playlistId]);

    json_response([
        'success' => true,
        'message' => 'Active playlist updated.',
        'device_id' => $canonicalDeviceId,
        'playlist_id' => $playlistId
    ]);
}

// -------------------------------------------------------------
// Route: DELETE /api/device/{deviceId}/playlist/{playlistId}
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/playlist/([^/]+)$#', $path, $matches) && $method === 'DELETE') {
    $deviceId = normalize_device_id($matches[1]);
    $playlistId = (int)$matches[2];

    // Check device existence & lock
    $devCheck = $db->prepare("SELECT id, device_id, id_lock FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1");
    $devCheck->execute([$deviceId, $deviceId]);
    $devRow = $devCheck->fetch();

    if (!$devRow) {
        json_response(['success' => false, 'error' => ['code' => 'DEVICE_NOT_FOUND', 'message' => 'Device not found.']], 404);
    }
    if ((int)$devRow['id_lock'] === 1) {
        json_response(['success' => false, 'error' => ['code' => 'DEVICE_LOCKED', 'message' => 'Device is Locked! This device has been locked in FOX PLAYER app settings. Please unlock it from the app first before modifying playlists.']], 403);
    }
    $canonicalDeviceId = $devRow['device_id'];

    $del = $db->prepare("DELETE FROM device_playlists WHERE device_id = ? AND playlist_id = ?");
    $del->execute([$canonicalDeviceId, $playlistId]);

    // If an active one was deleted, make another one active
    $cntActive = $db->prepare("SELECT COUNT(*) FROM device_playlists WHERE device_id = ? AND is_active = 1");
    $cntActive->execute([$canonicalDeviceId]);
    if ((int)$cntActive->fetchColumn() === 0) {
        $db->prepare("UPDATE device_playlists SET is_active = 1 WHERE device_id = ? LIMIT 1")->execute([$canonicalDeviceId]);
    }

    json_response(['success' => true, 'message' => 'Playlist removed from device.', 'device_id' => $canonicalDeviceId]);
}

// -------------------------------------------------------------
// Route: DELETE /api/device/{deviceId}/playlists/all (HotPlayer Wipe Feature)
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/playlists/all$#', $path, $matches) && ($method === 'DELETE' || $method === 'POST')) {
    $deviceId = normalize_device_id($matches[1]);

    // Check device existence & lock
    $devCheck = $db->prepare("SELECT id, device_id, id_lock FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1");
    $devCheck->execute([$deviceId, $deviceId]);
    $devRow = $devCheck->fetch();

    if (!$devRow) {
        json_response(['success' => false, 'error' => ['code' => 'DEVICE_NOT_FOUND', 'message' => 'Device not found.']], 404);
    }
    if ((int)$devRow['id_lock'] === 1) {
        json_response(['success' => false, 'error' => ['code' => 'DEVICE_LOCKED', 'message' => 'Device is Locked! This device has been locked in FOX PLAYER app settings. Please unlock it from the app first before wiping playlists.']], 403);
    }
    $canonicalDeviceId = $devRow['device_id'];

    $db->prepare("DELETE FROM device_playlists WHERE device_id = ?")->execute([$canonicalDeviceId]);
    json_response(['success' => true, 'message' => 'All playlist links removed successfully from device.', 'device_id' => $canonicalDeviceId]);
}

// -------------------------------------------------------------
// Route: GET /api/device/{deviceId}/id-lock
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/id-lock$#', $path, $matches) && $method === 'GET') {
    $deviceId = normalize_device_id($matches[1]);
    $stmt = $db->prepare("SELECT id, device_id, id_lock FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1");
    $stmt->execute([$deviceId, $deviceId]);
    $row = $stmt->fetch();

    if (!$row) {
        json_response(['success' => false, 'error' => ['code' => 'DEVICE_NOT_FOUND', 'message' => 'Device not found.']], 404);
    }

    json_response(['success' => true, 'device_id' => $row['device_id'], 'id_lock' => (bool)$row['id_lock']]);
}

// -------------------------------------------------------------
// Route: POST /api/device/{deviceId}/id-lock (Toggle Lock from App)
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/id-lock$#', $path, $matches) && $method === 'POST') {
    $deviceId = normalize_device_id($matches[1]);
    $input = get_json_input();
    $idLock = !empty($input['id_lock']) ? 1 : 0;

    $stmt = $db->prepare("SELECT id, device_id FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1");
    $stmt->execute([$deviceId, $deviceId]);
    $row = $stmt->fetch();

    if (!$row) {
        json_response([
            'success' => false,
            'error' => ['code' => 'DEVICE_NOT_FOUND', 'message' => 'Device not found. Please open FOX PLAYER app on your device first.']
        ], 404);
    }

    $upd = $db->prepare("UPDATE devices SET id_lock = ?, last_seen_at = NOW() WHERE id = ?");
    $upd->execute([$idLock, $row['id']]);

    json_response(['success' => true, 'device_id' => $row['device_id'], 'id_lock' => (bool)$idLock]);
}

// -------------------------------------------------------------
// Route: GET /api/device/{deviceId}/pairing-token
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/pairing-token$#', $path, $matches) && $method === 'GET') {
    $deviceId = normalize_device_id($matches[1]);
    $pairingCode = sprintf('%06d', random_int(100000, 999999));
    $pairingToken = bin2hex(random_bytes(24));
    $expiresAt = gmdate('Y-m-d H:i:s', time() + 900); // 15 mins

    $db->prepare("
        INSERT INTO devices (device_id, pairing_code, pairing_token, pairing_token_expires_at, last_seen_at)
        VALUES (?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
            pairing_code = VALUES(pairing_code),
            pairing_token = VALUES(pairing_token),
            pairing_token_expires_at = VALUES(pairing_token_expires_at)
    ")->execute([$deviceId, $pairingCode, $pairingToken, $expiresAt]);

    json_response([
        'success' => true,
        'device_id' => $deviceId,
        'pairing_code' => $pairingCode,
        'pairing_token' => $pairingToken,
        'expires_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime($expiresAt . ' UTC'))
    ]);
}

// -------------------------------------------------------------
// Route: GET /api/device/{deviceId}/pairing-status (QR / manage page GET verify)
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/pairing-status$#', $path, $matches) && $method === 'GET') {
    $deviceId = normalize_device_id($matches[1]);
    $token = trim((string)($_GET['token'] ?? ($_GET['pairing_token'] ?? '')));

    if ($token === '') {
        json_response([
            'success' => true,
            'valid' => false,
            'device_id' => $deviceId,
            'reason' => 'MISSING_TOKEN',
        ]);
    }

    $stmt = $db->prepare("
        SELECT id, device_id, id_lock, pairing_token_expires_at
        FROM devices
        WHERE device_id = ? AND pairing_token = ?
        LIMIT 1
    ");
    $stmt->execute([$deviceId, $token]);
    $row = $stmt->fetch();

    if (!$row) {
        json_response([
            'success' => true,
            'valid' => false,
            'device_id' => $deviceId,
            'reason' => 'INVALID_TOKEN',
        ]);
    }

    $expiresAt = $row['pairing_token_expires_at'] ?? null;
    $expired = false;
    if ($expiresAt) {
        $expired = (strtotime((string)$expiresAt) < time());
    }

    json_response([
        'success' => true,
        'valid' => !$expired,
        'device_id' => $row['device_id'],
        'id_lock' => (bool)$row['id_lock'],
        'expires_at' => $expiresAt,
        'reason' => $expired ? 'EXPIRED' : null,
    ]);
}

// -------------------------------------------------------------
// Route: POST /api/auth/pair
// -------------------------------------------------------------
if ($path === '/api/auth/pair' && $method === 'POST') {
    $input = get_json_input();
    $deviceId = normalize_device_id($input['device_id'] ?? '');
    $codeOrToken = trim($input['code'] ?? ($input['token'] ?? ''));

    $stmt = $db->prepare("
        SELECT id, id_lock, pairing_token_expires_at 
        FROM devices 
        WHERE device_id = ? AND (pairing_code = ? OR pairing_token = ?)
        LIMIT 1
    ");
    $stmt->execute([$deviceId, $codeOrToken, $codeOrToken]);
    $row = $stmt->fetch();

    if (!$row) {
        json_response(['success' => false, 'error' => ['code' => 'INVALID_CODE', 'message' => 'Invalid or expired pairing code.']], 401);
    }

    $sessionToken = bin2hex(random_bytes(32));
    $sessExpires = gmdate('Y-m-d H:i:s', time() + 86400 * 7);

    $db->prepare("UPDATE devices SET session_token = ?, session_token_expires_at = ? WHERE id = ?")->execute([$sessionToken, $sessExpires, $row['id']]);

    json_response([
        'success' => true,
        'device_id' => $deviceId,
        'session_token' => $sessionToken,
        'expires_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime($sessExpires . ' UTC')),
        'id_lock' => (bool)$row['id_lock']
    ]);
}

// -------------------------------------------------------------
// Route: GET /api/device/{deviceId}/user-data (Retrieve saved favorites & settings)
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/user-data$#', $path, $matches) && $method === 'GET') {
    $deviceId = normalize_device_id($matches[1]);
    $udStmt = $db->prepare("SELECT data_key, data_value, updated_at FROM device_user_data WHERE device_id = ?");
    $udStmt->execute([$deviceId]);
    $rows = $udStmt->fetchAll();
    $userData = [];
    foreach ($rows as $r) {
        $dec = json_decode($r['data_value'], true);
        $userData[$r['data_key']] = ($dec !== null) ? $dec : $r['data_value'];
    }
    json_response([
        'success' => true,
        'device_id' => $deviceId,
        'user_data' => $userData,
        'encrypted_user_data' => encrypt_payload($userData)
    ]);
}

// -------------------------------------------------------------
// Route: POST /api/device/{deviceId}/user-data (Sync favorites & preferences to server)
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/user-data$#', $path, $matches) && $method === 'POST') {
    $deviceId = normalize_device_id($matches[1]);
    $input = get_json_input();

    $devCheck = $db->prepare("SELECT id FROM devices WHERE device_id = ? LIMIT 1");
    $devCheck->execute([$deviceId]);
    if (!$devCheck->fetch()) {
        json_response(['success' => false, 'error' => ['code' => 'DEVICE_NOT_FOUND', 'message' => 'Device not found.']], 404);
    }

    $entries = [];
    if (isset($input['key'])) {
        $entries[$input['key']] = $input['value'] ?? null;
    } elseif (isset($input['data']) && is_array($input['data'])) {
        $entries = $input['data'];
    }

    if (empty($entries)) {
        json_response(['success' => false, 'error' => ['code' => 'INVALID_PAYLOAD', 'message' => 'Key and value or data map required.']], 400);
    }

    $stmt = $db->prepare("
        INSERT INTO device_user_data (device_id, data_key, data_value, updated_at)
        VALUES (?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE data_value = VALUES(data_value), updated_at = NOW()
    ");

    foreach ($entries as $k => $v) {
        $valStr = is_string($v) ? $v : json_encode($v, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $stmt->execute([$deviceId, (string)$k, $valStr]);
    }

    json_response(['success' => true, 'updated_keys' => array_keys($entries)]);
}

// -------------------------------------------------------------
// Route: POST /api/device/{deviceId}/session
// -------------------------------------------------------------
if (preg_match('#^/api/device/([^/]+)/session$#', $path, $matches) && $method === 'POST') {
    $deviceId = normalize_device_id($matches[1]);
    $sessionToken = bin2hex(random_bytes(32));
    $sessExpires = gmdate('Y-m-d H:i:s', time() + 86400 * 7);

    $db->prepare("
        INSERT INTO devices (device_id, session_token, session_token_expires_at, last_seen_at)
        VALUES (?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE session_token = VALUES(session_token), session_token_expires_at = VALUES(session_token_expires_at)
    ")->execute([$deviceId, $sessionToken, $sessExpires]);

    json_response([
        'success' => true,
        'device_id' => $deviceId,
        'session_token' => $sessionToken,
        'expires_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime($sessExpires . ' UTC'))
    ]);
}

// =============================================================
// ADMIN ROUTES
// =============================================================

// Route: POST /api/admin/login
if ($path === '/api/admin/login' && $method === 'POST') {
    $input = get_json_input();
    $password = trim($input['password'] ?? '');

    if ($password !== ADMIN_SECRET) {
        json_response(['success' => false, 'error' => ['code' => 'INVALID_CREDENTIALS', 'message' => 'Invalid admin secret password.']], 401);
    }

    $token = hash('sha256', $password . '_SESSION_' . time());
    // Store in admins table
    $db->prepare("
        INSERT INTO admins (username, password_hash, created_at)
        VALUES ('admin', ?, NOW())
        ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)
    ")->execute([$token]);

    json_response([
        'success' => true,
        'token' => $token,
        'expires_at' => gmdate('Y-m-d\TH:i:s\Z', time() + 86400)
    ]);
}

// Require admin auth for all subsequent /api/admin/* routes
if (str_starts_with($path, '/api/admin/')) {
    if (!verify_admin()) {
        json_response(['success' => false, 'error' => ['code' => 'UNAUTHORIZED_ADMIN', 'message' => 'Administrative authorization required.']], 401);
    }
}

// Route: GET /api/admin/stats
if ($path === '/api/admin/stats' && $method === 'GET') {
    $totalDevices = (int)$db->query("SELECT COUNT(*) FROM devices")->fetchColumn();
    $activeDevices = (int)$db->query("SELECT COUNT(*) FROM devices WHERE last_seen_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)")->fetchColumn();
    
    $trialUsers = (int)$db->query("SELECT COUNT(*) FROM subscriptions WHERE subscription_type = 'trial' AND expires_at > NOW() AND status = 'active'")->fetchColumn();
    $paid1Year = (int)$db->query("SELECT COUNT(*) FROM subscriptions WHERE subscription_type = 'year_1' AND expires_at > NOW() AND status = 'active'")->fetchColumn();
    $paidForever = (int)$db->query("SELECT COUNT(*) FROM subscriptions WHERE subscription_type = 'forever' AND status = 'active'")->fetchColumn();
    $expiredUsers = (int)$db->query("SELECT COUNT(*) FROM subscriptions WHERE expires_at <= NOW() OR status = 'expired'")->fetchColumn();
    
    $totalPlaylists = (int)$db->query("SELECT COUNT(*) FROM playlists")->fetchColumn();
    $m3uPlaylists = (int)$db->query("SELECT COUNT(*) FROM playlists WHERE type = 'm3u'")->fetchColumn();
    $xtreamPlaylists = (int)$db->query("SELECT COUNT(*) FROM playlists WHERE type = 'xtream'")->fetchColumn();

    $setStmt = $db->query("SELECT trial_enabled, trial_duration_days FROM subscription_settings WHERE id = 1 LIMIT 1");
    $settings = $setStmt->fetch() ?: ['trial_enabled' => 1, 'trial_duration_days' => 7];

    json_response([
        'success' => true,
        'stats' => [
            'total_devices' => $totalDevices,
            'active_devices_7d' => $activeDevices,
            'trial_users' => $trialUsers,
            'paid_users' => $paid1Year + $paidForever,
            'paid_1year' => $paid1Year,
            'paid_forever' => $paidForever,
            'expired_users' => $expiredUsers,
            'total_playlists' => $totalPlaylists,
            'm3u_playlists' => $m3uPlaylists,
            'xtream_playlists' => $xtreamPlaylists,
            'trial_enabled' => (bool)$settings['trial_enabled'],
            'trial_duration_days' => (int)$settings['trial_duration_days']
        ]
    ]);
}

// Route: GET /api/admin/trial-settings
if ($path === '/api/admin/trial-settings' && $method === 'GET') {
    $stmt = $db->query("SELECT id, trial_enabled, trial_duration_days, updated_at, updated_by, notes FROM subscription_settings WHERE id = 1 LIMIT 1");
    $settings = $stmt->fetch() ?: ['trial_enabled' => 1, 'trial_duration_days' => 7];
    json_response(['success' => true, 'settings' => $settings]);
}

// Route: PUT/POST /api/admin/trial-settings (Update default trial days)
if ($path === '/api/admin/trial-settings' && ($method === 'PUT' || $method === 'POST')) {
    $input = get_json_input();
    $trialEnabled = isset($input['trial_enabled']) ? (int)(bool)$input['trial_enabled'] : 1;
    $trialDays = (int)($input['trial_duration_days'] ?? 7);
    if ($trialDays < 1) $trialDays = 7;
    $notes = trim($input['notes'] ?? 'Updated via admin dashboard');

    $stmt = $db->prepare("
        INSERT INTO subscription_settings (id, trial_enabled, trial_duration_days, updated_at, updated_by, notes)
        VALUES (1, ?, ?, NOW(), 'admin', ?)
        ON DUPLICATE KEY UPDATE
            trial_enabled = VALUES(trial_enabled),
            trial_duration_days = VALUES(trial_duration_days),
            updated_at = NOW(),
            updated_by = 'admin',
            notes = VALUES(notes)
    ");
    $stmt->execute([$trialEnabled, $trialDays, $notes]);

    // Audit log
    $db->prepare("INSERT INTO subscription_audit_logs (action, target_type, target_id, details) VALUES ('update_trial_settings', 'settings', '1', ?)")
       ->execute([json_encode(['trial_duration_days' => $trialDays, 'trial_enabled' => $trialEnabled])]);

    json_response([
        'success' => true,
        'message' => 'Default trial settings updated successfully. New trial duration will apply to subsequent registrations.',
        'settings' => [
            'trial_enabled' => (bool)$trialEnabled,
            'trial_duration_days' => $trialDays,
            'updated_at' => gmdate('Y-m-d\TH:i:s\Z')
        ]
    ]);
}

// Route: GET /api/admin/devices
if ($path === '/api/admin/devices' && $method === 'GET') {
    $search = trim($_GET['search'] ?? '');
    $filter = trim($_GET['filter'] ?? 'all'); // all, trial, paid, expired
    $limit = min(100, max(1, (int)($_GET['limit'] ?? 50)));
    $offset = max(0, (int)($_GET['offset'] ?? 0));

    $sql = "
        SELECT d.id, d.device_id, d.mac_address, d.id_lock, d.status as device_status, d.last_seen_at, d.created_at,
               s.subscription_type, s.status as sub_status, s.starts_at, s.expires_at, s.duration_days,
               COUNT(dp.id) as playlists_count
        FROM devices d
        LEFT JOIN subscriptions s ON s.device_id = d.device_id
        LEFT JOIN device_playlists dp ON dp.device_id = d.device_id
    ";

    $where = [];
    $params = [];

    if (!empty($search)) {
        $where[] = "(d.device_id LIKE ? OR d.mac_address LIKE ?)";
        $params[] = "%{$search}%";
        $params[] = "%{$search}%";
    }

    if ($filter === 'trial') {
        $where[] = "s.subscription_type = 'trial' AND s.expires_at > NOW() AND s.status = 'active'";
    } elseif ($filter === 'paid') {
        $where[] = "s.subscription_type IN ('year_1', 'forever', 'custom') AND s.status = 'active'";
    } elseif ($filter === 'expired') {
        $where[] = "(s.expires_at <= NOW() OR s.status = 'expired')";
    }

    if (!empty($where)) {
        $sql .= " WHERE " . implode(' AND ', $where);
    }

    $sql .= " GROUP BY d.id, s.id ORDER BY d.id DESC LIMIT {$limit} OFFSET {$offset}";

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $devices = $stmt->fetchAll();

    $now = time();
    foreach ($devices as &$dev) {
        $expiryTime = !empty($dev['expires_at']) ? strtotime($dev['expires_at'] . ' UTC') : 0;
        $dev['is_active'] = ($expiryTime > $now) && ($dev['sub_status'] === 'active');
        $dev['days_left'] = max(0, (int)ceil(($expiryTime - $now) / 86400));
        $dev['playlists_count'] = (int)$dev['playlists_count'];
    }

    json_response(['success' => true, 'count' => count($devices), 'devices' => $devices]);
}

// Route: GET /api/admin/devices/{id} (Full details + playlists)
if (preg_match('#^/api/admin/devices/([^/]+)$#', $path, $matches) && $method === 'GET') {
    $idOrDevice = normalize_device_id($matches[1]);
    $stmt = $db->prepare("
        SELECT d.*, s.subscription_type, s.status as sub_status, s.starts_at, s.expires_at, s.duration_days, s.source
        FROM devices d
        LEFT JOIN subscriptions s ON s.device_id = d.device_id
        WHERE d.device_id = ? OR d.mac_address = ?
        LIMIT 1
    ");
    $stmt->execute([$idOrDevice, $idOrDevice]);
    $dev = $stmt->fetch();

    if (!$dev) {
        json_response(['success' => false, 'error' => ['code' => 'NOT_FOUND', 'message' => 'Device not found.']], 404);
    }

    // Get playlists
    $pStmt = $db->prepare("
        SELECT dp.id as device_playlist_id, dp.playlist_name, dp.is_active, dp.enabled, dp.created_at,
               p.type, p.playlist_url, p.server_url, p.username, p.password_encrypted
        FROM device_playlists dp
        JOIN playlists p ON p.id = dp.playlist_id
        WHERE dp.device_id = ?
        ORDER BY dp.id ASC
    ");
    $pStmt->execute([$dev['device_id']]);
    $pRows = $pStmt->fetchAll();

    $playlists = [];
    foreach ($pRows as $p) {
        $playlists[] = [
            'id' => (int)$p['device_playlist_id'],
            'name' => $p['playlist_name'],
            'type' => $p['type'],
            'url' => $p['playlist_url'],
            'server_url' => $p['server_url'],
            'username' => $p['username'],
            'password' => decrypt_secret($p['password_encrypted']),
            'is_active' => (bool)$p['is_active'],
            'enabled' => (bool)$p['enabled'],
            'created_at' => $p['created_at']
        ];
    }

    $expiryTime = !empty($dev['expires_at']) ? strtotime($dev['expires_at'] . ' UTC') : 0;
    $now = time();
    $dev['is_active'] = ($expiryTime > $now) && ($dev['sub_status'] === 'active');
    $dev['days_left'] = max(0, (int)ceil(($expiryTime - $now) / 86400));
    $dev['playlists'] = $playlists;

    json_response(['success' => true, 'device' => $dev]);
}

// Route: PUT/POST /api/admin/devices/{id}/subscription (Edit subscription)
if (preg_match('#^/api/admin/devices/([^/]+)/subscription$#', $path, $matches) && ($method === 'PUT' || $method === 'POST')) {
    $idOrDevice = normalize_device_id($matches[1]);
    $input = get_json_input();

    $subType = strtolower(trim($input['subscription_type'] ?? 'year_1'));
    $status = strtolower(trim($input['status'] ?? 'active'));
    $durationDays = isset($input['duration_days']) ? (int)$input['duration_days'] : null;
    $expiresAt = trim($input['expires_at'] ?? '');
    $notes = trim($input['notes'] ?? 'Admin manual update');

    // Get device ID
    $dStmt = $db->prepare("SELECT device_id FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1");
    $dStmt->execute([$idOrDevice, $idOrDevice]);
    $dev = $dStmt->fetch();
    $deviceId = $dev ? $dev['device_id'] : $idOrDevice;

    if (!empty($expiresAt)) {
        $expiryDb = gmdate('Y-m-d H:i:s', strtotime($expiresAt));
        $durationDays = max(1, (int)ceil((strtotime($expiresAt) - time()) / 86400));
    } else {
        if (in_array($subType, ['forever', 'lifetime', 'permanent'], true)) {
            $durationDays = 18250;
        } else {
            $durationDays = $durationDays ?: 365;
        }
        $expiryDb = gmdate('Y-m-d H:i:s', time() + ($durationDays * 86400));
    }

    $startsAt = gmdate('Y-m-d H:i:s');

    $checkSub = $db->prepare("SELECT id FROM subscriptions WHERE device_id = ? LIMIT 1");
    $checkSub->execute([$deviceId]);
    $existing = $checkSub->fetch();

    if ($existing) {
        $upd = $db->prepare("
            UPDATE subscriptions 
            SET subscription_type = ?, status = ?, expires_at = ?, duration_days = ?, notes = ?, updated_at = NOW()
            WHERE id = ?
        ");
        $upd->execute([$subType, $status, $expiryDb, $durationDays, $notes, $existing['id']]);
    } else {
        $ins = $db->prepare("
            INSERT INTO subscriptions (device_id, subscription_type, status, starts_at, expires_at, duration_days, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ");
        $ins->execute([$deviceId, $subType, $status, $startsAt, $expiryDb, $durationDays, $notes]);
    }

    // Audit log
    $db->prepare("INSERT INTO subscription_audit_logs (action, target_type, target_id, details) VALUES ('admin_update_subscription', 'device', ?, ?)")
       ->execute([$deviceId, json_encode(['type' => $subType, 'status' => $status, 'expires_at' => $expiryDb])]);

    json_response([
        'success' => true,
        'message' => 'Subscription updated successfully.',
        'device_id' => $deviceId,
        'subscription' => [
            'type' => $subType,
            'status' => $status,
            'expires_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime($expiryDb . ' UTC')),
            'days_left' => $durationDays
        ]
    ]);
}

// Route: DELETE /api/admin/devices/{id}
if (preg_match('#^/api/admin/devices/([^/]+)$#', $path, $matches) && $method === 'DELETE') {
    $idOrDevice = normalize_device_id($matches[1]);
    $db->prepare("DELETE FROM devices WHERE device_id = ? OR mac_address = ?")->execute([$idOrDevice, $idOrDevice]);
    $db->prepare("DELETE FROM subscriptions WHERE device_id = ?")->execute([$idOrDevice]);
    $db->prepare("DELETE FROM device_playlists WHERE device_id = ?")->execute([$idOrDevice]);

    json_response(['success' => true, 'message' => 'Device and associated records deleted.']);
}

// Route: GET /api/admin/playlists
if ($path === '/api/admin/playlists' && $method === 'GET') {
    $limit = min(500, max(1, (int)($_GET['limit'] ?? 100)));
    $stmt = $db->prepare("
        SELECT p.id, p.type, p.playlist_url, p.server_url, p.username, p.updated_at,
               (SELECT COUNT(*) FROM device_playlists dp WHERE dp.playlist_id = p.id) AS device_count
        FROM playlists p
        ORDER BY p.updated_at DESC
        LIMIT {$limit}
    ");
    $stmt->execute();
    json_response(['success' => true, 'playlists' => $stmt->fetchAll(), 'count' => $stmt->rowCount()]);
}

// Route: GET /api/admin/playlists/{id}
if (preg_match('#^/api/admin/playlists/([0-9]+)$#', $path, $matches) && $method === 'GET') {
    $pid = (int)$matches[1];
    $stmt = $db->prepare("SELECT id, type, playlist_url, server_url, username, updated_at FROM playlists WHERE id = ? LIMIT 1");
    $stmt->execute([$pid]);
    $row = $stmt->fetch();
    if (!$row) {
        json_response(['success' => false, 'error' => ['code' => 'NOT_FOUND', 'message' => 'Playlist not found.']], 404);
    }
    json_response(['success' => true, 'playlist' => $row]);
}

// Route: PUT/POST /api/admin/playlists/{id}
if (preg_match('#^/api/admin/playlists/([0-9]+)$#', $path, $matches) && ($method === 'PUT' || $method === 'POST')) {
    $pid = (int)$matches[1];
    $input = get_json_input();
    $stmt = $db->prepare("SELECT id FROM playlists WHERE id = ? LIMIT 1");
    $stmt->execute([$pid]);
    if (!$stmt->fetch()) {
        json_response(['success' => false, 'error' => ['code' => 'NOT_FOUND', 'message' => 'Playlist not found.']], 404);
    }

    $fields = [];
    $params = [];
    if (isset($input['server_url'])) {
        $fields[] = 'server_url = ?';
        $params[] = trim((string)$input['server_url']) ?: null;
    }
    if (isset($input['playlist_url'])) {
        $fields[] = 'playlist_url = ?';
        $params[] = trim((string)$input['playlist_url']) ?: null;
    }
    if (isset($input['username'])) {
        $fields[] = 'username = ?';
        $params[] = trim((string)$input['username']) ?: null;
    }
    if (!empty($input['password'])) {
        $fields[] = 'password_encrypted = ?';
        $params[] = encrypt_secret((string)$input['password']);
    }
    if (isset($input['type'])) {
        $fields[] = 'type = ?';
        $params[] = strtolower(trim((string)$input['type'])) === 'xtream' ? 'xtream' : 'm3u';
    }
    if (empty($fields)) {
        json_response(['success' => false, 'error' => ['code' => 'NO_CHANGES', 'message' => 'No fields to update.']], 400);
    }
    $fields[] = 'updated_at = NOW()';
    $params[] = $pid;
    $db->prepare('UPDATE playlists SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);

    $db->prepare("INSERT INTO subscription_audit_logs (action, target_type, target_id, details) VALUES ('admin_update_playlist', 'playlist', ?, ?)")
        ->execute([$pid, json_encode(['admin' => true])]);

    json_response(['success' => true, 'playlist_id' => $pid]);
}

// Route: DELETE /api/admin/playlists/{id}
if (preg_match('#^/api/admin/playlists/([0-9]+)$#', $path, $matches) && $method === 'DELETE') {
    $pid = (int)$matches[1];
    $db->prepare('DELETE FROM device_playlists WHERE playlist_id = ?')->execute([$pid]);
    $db->prepare('DELETE FROM playlists WHERE id = ?')->execute([$pid]);
    $db->prepare("INSERT INTO subscription_audit_logs (action, target_type, target_id, details) VALUES ('admin_delete_playlist', 'playlist', ?, ?)")
        ->execute([$pid, json_encode(['admin' => true])]);
    json_response(['success' => true, 'deleted' => $pid]);
}

// Route: GET /api/admin/tools/replace-server-url/preview (from_url only — step 1 validation)
if ($path === '/api/admin/tools/replace-server-url/preview' && $method === 'GET') {
    $from = normalize_server_url_compare((string)($_GET['from_url'] ?? ''));
    $toRaw = trim((string)($_GET['to_url'] ?? ''));
    $to = $toRaw !== '' ? normalize_server_url_compare($toRaw) : '';
    if ($from === '') {
        json_response(['success' => false, 'error' => ['code' => 'INVALID', 'message' => 'Enter the current (old) server URL first.']], 400);
    }
    $stmt = $db->prepare('SELECT id, server_url FROM playlists WHERE server_url IS NOT NULL AND server_url != ""');
    $stmt->execute();
    $match = 0;
    $ids = [];
    while ($row = $stmt->fetch()) {
        if (normalize_server_url_compare((string)$row['server_url']) === $from) {
            $match++;
            $ids[] = (int)$row['id'];
        }
    }
    $sample = [];
    if ($match > 0 && count($ids) > 0) {
        $in = implode(',', array_slice($ids, 0, 5));
        $sampleRows = $db->query("SELECT id, server_url, username FROM playlists WHERE id IN ({$in})")->fetchAll();
        $sample = $sampleRows ?: [];
    }

    json_response([
        'success' => true,
        'validated' => $match > 0,
        'from_url' => $from,
        'to_url' => $to ?: null,
        'match_count' => $match,
        'playlist_ids' => $ids,
        'sample' => $sample,
    ]);
}

// Route: POST /api/admin/devices/{id}/apply-plan (assign subscription plan from catalog)
if (preg_match('#^/api/admin/devices/([^/]+)/apply-plan$#', $path, $matches) && ($method === 'POST' || $method === 'PUT')) {
    $idOrDevice = normalize_device_id($matches[1]);
    $input = get_json_input();
    $planCode = trim((string)($input['plan_code'] ?? ''));
    if ($planCode === '') {
        json_response(['success' => false, 'error' => ['code' => 'INVALID', 'message' => 'plan_code required.']], 400);
    }
    $planStmt = $db->prepare('SELECT * FROM credit_plans WHERE code = ? AND is_active = 1 LIMIT 1');
    $planStmt->execute([$planCode]);
    $plan = $planStmt->fetch();
    if (!$plan) {
        json_response(['success' => false, 'error' => ['code' => 'PLAN_NOT_FOUND', 'message' => 'Unknown or inactive plan.']], 404);
    }
    $dStmt = $db->prepare('SELECT device_id FROM devices WHERE device_id = ? OR mac_address = ? LIMIT 1');
    $dStmt->execute([$idOrDevice, $idOrDevice]);
    $dev = $dStmt->fetch();
    $deviceId = $dev ? $dev['device_id'] : $idOrDevice;
    $days = (int)$plan['duration_days'];
    $subType = $planCode;
    if ($days >= 18000) {
        $subType = 'forever';
    } elseif ($days >= 300) {
        $subType = 'year_1';
    } elseif ($days <= 35) {
        $subType = 'month_1';
    }
    $startsAt = gmdate('Y-m-d H:i:s');
    $expiresAt = gmdate('Y-m-d H:i:s', time() + ($days * 86400));
    $notes = 'Admin applied plan: ' . ($plan['label'] ?? $planCode);
    $checkSub = $db->prepare('SELECT id FROM subscriptions WHERE device_id = ? LIMIT 1');
    $checkSub->execute([$deviceId]);
    $existing = $checkSub->fetch();
    if ($existing) {
        $db->prepare('UPDATE subscriptions SET subscription_type = ?, status = ?, starts_at = ?, expires_at = ?, duration_days = ?, source = ?, notes = ?, updated_at = NOW() WHERE id = ?')
            ->execute([$subType, 'active', $startsAt, $expiresAt, $days, 'admin_plan', $notes, $existing['id']]);
    } else {
        $db->prepare('INSERT INTO subscriptions (device_id, subscription_type, status, starts_at, expires_at, duration_days, source, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$deviceId, $subType, 'active', $startsAt, $expiresAt, $days, 'admin_plan', $notes]);
    }
    $db->prepare("INSERT INTO subscription_audit_logs (action, target_type, target_id, details) VALUES ('admin_apply_plan', 'device', ?, ?)")
        ->execute([$deviceId, json_encode(['plan_code' => $planCode, 'expires_at' => $expiresAt])]);
    json_response([
        'success' => true,
        'device_id' => $deviceId,
        'plan' => ['code' => $planCode, 'label' => $plan['label'], 'duration_days' => $days],
        'expires_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime($expiresAt . ' UTC')),
    ]);
}

// Route: GET /api/admin/subscription-plans (device + reseller plan catalog)
if ($path === '/api/admin/subscription-plans' && $method === 'GET') {
    $plans = $db->query('SELECT id, code, label, credits_cost, duration_days, is_active, sort_order FROM credit_plans ORDER BY sort_order ASC, id ASC')->fetchAll();
    json_response(['success' => true, 'plans' => $plans]);
}

// Route: POST /api/admin/tools/replace-server-url
if ($path === '/api/admin/tools/replace-server-url' && $method === 'POST') {
    $input = get_json_input();
    $from = normalize_server_url_compare((string)($input['from_url'] ?? ''));
    $toRaw = trim((string)($input['to_url'] ?? ''));
    $to = normalize_server_url_compare($toRaw);
    if ($from === '' || $to === '') {
        json_response(['success' => false, 'error' => ['code' => 'INVALID', 'message' => 'from_url and to_url required.']], 400);
    }
    if (empty($input['confirm'])) {
        json_response(['success' => false, 'error' => ['code' => 'CONFIRM_REQUIRED', 'message' => 'Set confirm=true to apply.']], 400);
    }

    $canonicalTo = $toRaw;
    if (!preg_match('#^https?://#i', $canonicalTo)) {
        $canonicalTo = 'http://' . $canonicalTo;
    }
    $canonicalTo = rtrim($canonicalTo, '/');

    $stmt = $db->prepare('SELECT id, server_url, playlist_url FROM playlists WHERE server_url IS NOT NULL AND server_url != ""');
    $stmt->execute();
    $updated = 0;
    $upd = $db->prepare('UPDATE playlists SET server_url = ?, playlist_url = ?, updated_at = NOW() WHERE id = ?');

    while ($row = $stmt->fetch()) {
        if (normalize_server_url_compare((string)$row['server_url']) !== $from) {
            continue;
        }
        $newPlaylistUrl = (string)($row['playlist_url'] ?? '');
        if ($newPlaylistUrl !== '' && str_contains($newPlaylistUrl, (string)$row['server_url'])) {
            $newPlaylistUrl = str_replace((string)$row['server_url'], $canonicalTo, $newPlaylistUrl);
        }
        $upd->execute([$canonicalTo, $newPlaylistUrl ?: null, (int)$row['id']]);
        $updated++;
    }

    $db->prepare("INSERT INTO subscription_audit_logs (action, target_type, target_id, details) VALUES ('admin_bulk_replace_server_url', 'system', 0, ?)")
        ->execute([json_encode(['from' => $from, 'to' => $canonicalTo, 'updated' => $updated])]);

    json_response(['success' => true, 'updated' => $updated, 'from_url' => $from, 'to_url' => $canonicalTo]);
}

// Route: GET /api/app/update-check
if ($path === '/api/app/update-check' && $method === 'GET') {
    $platform = strtolower(trim((string)($_GET['platform'] ?? 'all')));
    if (!in_array($platform, ['ios', 'android', 'all'], true)) {
        $platform = 'all';
    }
    $clientCode = (int)($_GET['version_code'] ?? ($_GET['build'] ?? 0));
    if ($clientCode <= 0) {
        $clientCode = 1;
    }
    $stmt = $db->prepare("
        SELECT * FROM app_versions
        WHERE platform IN (?, 'all')
        ORDER BY (platform = ?) DESC, version_code DESC
        LIMIT 1
    ");
    $stmt->execute([$platform, $platform]);
    $latest = $stmt->fetch();
    if (!$latest) {
        $payload = [
            'update_available' => false,
            'force_update' => false,
            'latest' => null,
            'client_version_code' => $clientCode,
            'client_version_name' => trim((string)($_GET['version_name'] ?? '')),
        ];
        json_response([
            'success' => true,
            'encrypted' => true,
            'data' => encrypt_payload($payload),
            'update_available' => false,
            'force_update' => false,
            'latest' => null,
            'client_version_code' => $clientCode,
        ]);
    }
    $latestCode = (int)$latest['version_code'];
    $needs = $latestCode > $clientCode;
    $payload = [
        'update_available' => $needs,
        'force_update' => $needs && ((int)$latest['is_required'] === 1),
        'latest' => [
            'version_name' => $latest['version_name'],
            'version_code' => $latestCode,
            'store_url' => $latest['store_url'],
            'release_notes' => $latest['release_notes'],
        ],
        'client_version_code' => $clientCode,
        'client_version_name' => trim((string)($_GET['version_name'] ?? '')),
    ];
    json_response([
        'success' => true,
        'encrypted' => true,
        'data' => encrypt_payload($payload),
        'update_available' => $needs,
        'force_update' => $payload['force_update'],
        'latest' => $payload['latest'],
        'client_version_code' => $clientCode,
    ]);
}

// Route: GET /api/device/{deviceId}/portal-data (encrypted playlists for web portal)
if (preg_match('#^/api/device/([^/]+)/portal-data$#', $path, $matches) && $method === 'GET') {
    $deviceId = normalize_device_id($matches[1]);
    $token = trim((string)($_GET['token'] ?? ''));
    if (!verify_device_pairing_token($db, $deviceId, $token)) {
        json_response(['success' => false, 'error' => ['code' => 'UNAUTHORIZED', 'message' => 'Invalid pairing session.']], 401);
    }
    $pStmt = $db->prepare("
        SELECT dp.id AS device_playlist_id, dp.playlist_name, dp.is_active, dp.enabled,
               p.id AS playlist_id, p.type, p.playlist_url, p.server_url, p.username
        FROM device_playlists dp
        JOIN playlists p ON p.id = dp.playlist_id
        WHERE dp.device_id = ?
        ORDER BY dp.is_active DESC, dp.id ASC
    ");
    $pStmt->execute([$deviceId]);
    $rows = $pStmt->fetchAll();
    $lockStmt = $db->prepare('SELECT id_lock FROM devices WHERE device_id = ? LIMIT 1');
    $lockStmt->execute([$deviceId]);
    $lockRow = $lockStmt->fetch();
    json_encrypted_success([
        'device_id' => $deviceId,
        'playlists' => $rows,
        'id_lock' => (bool)($lockRow['id_lock'] ?? false),
    ]);
}

// Route: PUT /api/device/{deviceId}/playlists/{devicePlaylistId}
if (preg_match('#^/api/device/([^/]+)/playlists/([0-9]+)$#', $path, $matches) && ($method === 'PUT' || $method === 'POST')) {
    $deviceId = normalize_device_id($matches[1]);
    $dpId = (int)$matches[2];
    $input = get_json_input();
    $token = trim((string)($input['token'] ?? ($_GET['token'] ?? '')));
    if (!verify_device_pairing_token($db, $deviceId, $token)) {
        json_response(['success' => false, 'error' => ['code' => 'UNAUTHORIZED', 'message' => 'Invalid pairing session.']], 401);
    }
    assert_device_unlocked($db, $deviceId);
    $link = $db->prepare('SELECT dp.playlist_id FROM device_playlists dp WHERE dp.id = ? AND dp.device_id = ? LIMIT 1');
    $link->execute([$dpId, $deviceId]);
    $linkRow = $link->fetch();
    if (!$linkRow) {
        json_response(['success' => false, 'error' => ['code' => 'NOT_FOUND', 'message' => 'Playlist link not found.']], 404);
    }
    $playlistId = (int)$linkRow['playlist_id'];
    if (!empty($input['playlist_name'])) {
        $db->prepare('UPDATE device_playlists SET playlist_name = ?, updated_at = NOW() WHERE id = ?')->execute([trim((string)$input['playlist_name']), $dpId]);
    }
    $fields = [];
    $params = [];
    foreach (['server_url' => 'server_url', 'username' => 'username', 'playlist_url' => 'playlist_url'] as $k => $col) {
        if (isset($input[$k])) {
            $fields[] = "{$col} = ?";
            $params[] = trim((string)$input[$k]) ?: null;
        }
    }
    if (!empty($input['password'])) {
        $fields[] = 'password_encrypted = ?';
        $params[] = encrypt_secret((string)$input['password']);
    }
    if ($fields) {
        $fields[] = 'updated_at = NOW()';
        $params[] = $playlistId;
        $db->prepare('UPDATE playlists SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
    }
    json_response(['success' => true, 'device_playlist_id' => $dpId]);
}

// Route: DELETE /api/device/{deviceId}/playlists/{devicePlaylistId}
if (preg_match('#^/api/device/([^/]+)/playlists/([0-9]+)$#', $path, $matches) && $method === 'DELETE') {
    $deviceId = normalize_device_id($matches[1]);
    $dpId = (int)$matches[2];
    $token = trim((string)($_GET['token'] ?? ''));
    if (!verify_device_pairing_token($db, $deviceId, $token)) {
        json_response(['success' => false, 'error' => ['code' => 'UNAUTHORIZED', 'message' => 'Invalid pairing session.']], 401);
    }
    assert_device_unlocked($db, $deviceId);
    $db->prepare('DELETE FROM device_playlists WHERE id = ? AND device_id = ?')->execute([$dpId, $deviceId]);
    json_response(['success' => true]);
}

// Route: POST /api/reseller/login
if ($path === '/api/reseller/login' && $method === 'POST') {
    $input = get_json_input();
    $user = trim((string)($input['username'] ?? ''));
    $pass = (string)($input['password'] ?? '');
    $stmt = $db->prepare('SELECT * FROM resellers WHERE username = ? AND is_active = 1 LIMIT 1');
    $stmt->execute([$user]);
    $row = $stmt->fetch();
    if (!$row || !hash_equals((string)$row['password_hash'], hash('sha256', $pass))) {
        json_response(['success' => false, 'error' => ['code' => 'INVALID_CREDENTIALS', 'message' => 'Invalid reseller credentials.']], 401);
    }
    $apiToken = bin2hex(random_bytes(24));
    $db->prepare('UPDATE resellers SET api_token = ?, updated_at = NOW() WHERE id = ?')->execute([$apiToken, $row['id']]);
    json_encrypted_success([
        'token' => $apiToken,
        'username' => $row['username'],
        'display_name' => $row['display_name'],
        'credits_balance' => (int)$row['credits_balance'],
    ]);
}

// Route: GET /api/reseller/plans
if ($path === '/api/reseller/plans' && $method === 'GET') {
    $reseller = verify_reseller($db);
    if (!$reseller) {
        json_response(['success' => false, 'error' => ['code' => 'UNAUTHORIZED', 'message' => 'Reseller auth required.']], 401);
    }
    $plans = $db->query('SELECT code, label, credits_cost, duration_days FROM credit_plans WHERE is_active = 1 ORDER BY sort_order ASC')->fetchAll();
    json_encrypted_success(['plans' => $plans, 'credits_balance' => (int)$reseller['credits_balance']]);
}

// Route: POST /api/reseller/activate-device
if ($path === '/api/reseller/activate-device' && $method === 'POST') {
    $reseller = verify_reseller($db);
    if (!$reseller) {
        json_response(['success' => false, 'error' => ['code' => 'UNAUTHORIZED', 'message' => 'Reseller auth required.']], 401);
    }
    $input = get_json_input();
    $deviceId = normalize_device_id($input['device_id'] ?? '');
    $planCode = trim((string)($input['plan_code'] ?? 'month_1'));
    $planStmt = $db->prepare('SELECT * FROM credit_plans WHERE code = ? AND is_active = 1 LIMIT 1');
    $planStmt->execute([$planCode]);
    $plan = $planStmt->fetch();
    if (!$plan || !$deviceId) {
        json_response(['success' => false, 'error' => ['code' => 'INVALID', 'message' => 'Invalid plan or device.']], 400);
    }
    $cost = (int)$plan['credits_cost'];
    if ((int)$reseller['credits_balance'] < $cost) {
        json_response(['success' => false, 'error' => ['code' => 'INSUFFICIENT_CREDITS', 'message' => 'Not enough credits.']], 402);
    }
    $dev = $db->prepare('SELECT id FROM devices WHERE device_id = ? LIMIT 1');
    $dev->execute([$deviceId]);
    if (!$dev->fetch()) {
        json_response(['success' => false, 'error' => ['code' => 'DEVICE_NOT_FOUND', 'message' => 'Device not registered in app.']], 404);
    }
    $days = (int)$plan['duration_days'];
    $startsAt = gmdate('Y-m-d H:i:s');
    $expiresAt = gmdate('Y-m-d H:i:s', time() + ($days * 86400));
    $subType = $planCode;
    if ($days >= 18000) {
        $subType = 'forever';
    } elseif ($days >= 300) {
        $subType = 'year_1';
    } elseif ($days <= 35) {
        $subType = 'month_1';
    }
    $notes = 'Reseller activation: ' . ($plan['label'] ?? $planCode);
    $subStmt = $db->prepare('SELECT id FROM subscriptions WHERE device_id = ? LIMIT 1');
    $subStmt->execute([$deviceId]);
    $existingSub = $subStmt->fetch();
    if ($existingSub) {
        $db->prepare("
            UPDATE subscriptions
            SET subscription_type = ?, status = 'active', starts_at = ?, expires_at = ?, duration_days = ?, source = 'reseller', notes = ?, updated_at = NOW()
            WHERE id = ?
        ")->execute([$subType, $startsAt, $expiresAt, $days, $notes, $existingSub['id']]);
    } else {
        $db->prepare("
            INSERT INTO subscriptions (device_id, subscription_type, status, starts_at, expires_at, duration_days, source, notes)
            VALUES (?, ?, 'active', ?, ?, ?, 'reseller', ?)
        ")->execute([$deviceId, $subType, $startsAt, $expiresAt, $days, $notes]);
    }
    $db->prepare('UPDATE resellers SET credits_balance = credits_balance - ?, updated_at = NOW() WHERE id = ?')->execute([$cost, $reseller['id']]);
    $db->prepare('INSERT INTO credit_ledger (reseller_id, delta, reason, actor) VALUES (?, ?, ?, ?)')->execute([(int)$reseller['id'], -$cost, 'activate ' . $deviceId . ' ' . $planCode, $reseller['username']]);
    $balStmt = $db->prepare('SELECT credits_balance FROM resellers WHERE id = ? LIMIT 1');
    $balStmt->execute([(int)$reseller['id']]);
    $newBalance = (int)($balStmt->fetchColumn() ?: 0);
    json_encrypted_success([
        'device_id' => $deviceId,
        'expires_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime($expiresAt . ' UTC')),
        'credits_spent' => $cost,
        'credits_balance' => $newBalance,
        'plan' => ['code' => $planCode, 'label' => $plan['label'] ?? $planCode, 'duration_days' => $days],
    ]);
}

// Route: GET /api/reseller/ledger (recent credit movements)
if ($path === '/api/reseller/ledger' && $method === 'GET') {
    $reseller = verify_reseller($db);
    if (!$reseller) {
        json_response(['success' => false, 'error' => ['code' => 'UNAUTHORIZED', 'message' => 'Reseller auth required.']], 401);
    }
    $limit = min(50, max(1, (int)($_GET['limit'] ?? 25)));
    $stmt = $db->prepare("SELECT id, delta, reason, actor, created_at FROM credit_ledger WHERE reseller_id = ? ORDER BY id DESC LIMIT {$limit}");
    $stmt->execute([(int)$reseller['id']]);
    $entries = $stmt->fetchAll();
    json_encrypted_success([
        'credits_balance' => (int)$reseller['credits_balance'],
        'entries' => $entries,
    ]);
}

// Admin: app versions
if (preg_match('#^/api/admin/app-versions/([0-9]+)$#', $path, $matches) && $method === 'DELETE') {
    $id = (int)$matches[1];
    $db->prepare('DELETE FROM app_versions WHERE id = ?')->execute([$id]);
    json_response(['success' => true, 'deleted' => $id]);
}
if ($path === '/api/admin/app-versions' && $method === 'GET') {
    $rows = $db->query('SELECT * FROM app_versions ORDER BY version_code DESC, id DESC')->fetchAll();
    foreach ($rows as &$row) {
        $row['is_required'] = (int)($row['is_required'] ?? 0);
        $row['version_code'] = (int)($row['version_code'] ?? 0);
    }
    unset($row);
    json_response([
        'success' => true,
        'versions' => $rows,
        'shipped_app' => fox_shipped_app_metadata(),
    ]);
}
if ($path === '/api/admin/app-versions' && $method === 'POST') {
    $input = get_json_input();
    $db->prepare('INSERT INTO app_versions (platform, version_name, version_code, is_required, store_url, release_notes) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([
            strtolower(trim((string)($input['platform'] ?? 'all'))),
            trim((string)($input['version_name'] ?? '1.0.0')),
            (int)($input['version_code'] ?? 1),
            !empty($input['is_required']) ? 1 : 0,
            trim((string)($input['store_url'] ?? '')) ?: null,
            trim((string)($input['release_notes'] ?? '')) ?: null,
        ]);
    json_response(['success' => true, 'id' => (int)$db->lastInsertId()]);
}

// Admin: credit plans
if ($path === '/api/admin/credit-plans' && $method === 'GET') {
    json_response(['success' => true, 'plans' => $db->query('SELECT * FROM credit_plans ORDER BY sort_order ASC')->fetchAll()]);
}
if ($path === '/api/admin/credit-plans' && ($method === 'POST' || $method === 'PUT')) {
    $input = get_json_input();
    if (!empty($input['id'])) {
        $db->prepare('UPDATE credit_plans SET label=?, credits_cost=?, duration_days=?, is_active=?, sort_order=? WHERE id=?')->execute([
            trim((string)$input['label']),
            (int)$input['credits_cost'],
            (int)$input['duration_days'],
            !empty($input['is_active']) ? 1 : 0,
            (int)($input['sort_order'] ?? 0),
            (int)$input['id'],
        ]);
    } else {
        $db->prepare('INSERT INTO credit_plans (code, label, credits_cost, duration_days, sort_order) VALUES (?, ?, ?, ?, ?)')->execute([
            trim((string)$input['code']),
            trim((string)$input['label']),
            (int)$input['credits_cost'],
            (int)$input['duration_days'],
            (int)($input['sort_order'] ?? 0),
        ]);
    }
    json_response(['success' => true]);
}

// Admin: credit ledger (all resellers)
if ($path === '/api/admin/credit-ledger' && $method === 'GET') {
    $limit = min(150, max(1, (int)($_GET['limit'] ?? 60)));
    $stmt = $db->prepare("
        SELECT cl.id, cl.reseller_id, cl.delta, cl.reason, cl.actor, cl.created_at,
               r.username, r.display_name
        FROM credit_ledger cl
        LEFT JOIN resellers r ON r.id = cl.reseller_id
        ORDER BY cl.id DESC
        LIMIT {$limit}
    ");
    $stmt->execute();
    json_response(['success' => true, 'entries' => $stmt->fetchAll()]);
}

// Admin: resellers
if ($path === '/api/admin/resellers' && $method === 'GET') {
    $rows = $db->query('SELECT id, username, display_name, credits_balance, is_active, created_at, updated_at FROM resellers ORDER BY id DESC')->fetchAll();
    $totalCredits = 0;
    foreach ($rows as &$r) {
        $r['credits_balance'] = (int)($r['credits_balance'] ?? 0);
        $totalCredits += $r['credits_balance'];
    }
    unset($r);
    json_response([
        'success' => true,
        'resellers' => $rows,
        'stats' => [
            'count' => count($rows),
            'total_credits' => $totalCredits,
            'active_count' => count(array_filter($rows, static fn ($x) => !empty($x['is_active']))),
        ],
    ]);
}
if ($path === '/api/admin/resellers' && $method === 'POST') {
    $input = get_json_input();
    $user = trim((string)($input['username'] ?? ''));
    $pass = (string)($input['password'] ?? '');
    if ($user === '' || $pass === '') {
        json_response(['success' => false, 'error' => ['code' => 'INVALID', 'message' => 'username and password required']], 400);
    }
    $db->prepare('INSERT INTO resellers (username, password_hash, display_name, credits_balance) VALUES (?, ?, ?, ?)')->execute([
        $user,
        hash('sha256', $pass),
        trim((string)($input['display_name'] ?? $user)),
        (int)($input['initial_credits'] ?? 0),
    ]);
    json_response(['success' => true, 'id' => (int)$db->lastInsertId()]);
}
if (preg_match('#^/api/admin/resellers/([0-9]+)/credits$#', $path, $matches) && $method === 'POST') {
    $rid = (int)$matches[1];
    $input = get_json_input();
    $delta = (int)($input['amount'] ?? 0);
    if ($delta === 0) {
        json_response(['success' => false, 'error' => ['code' => 'INVALID', 'message' => 'amount required']], 400);
    }
    $db->prepare('UPDATE resellers SET credits_balance = credits_balance + ?, updated_at = NOW() WHERE id = ?')->execute([$delta, $rid]);
    $db->prepare('INSERT INTO credit_ledger (reseller_id, delta, reason, actor) VALUES (?, ?, ?, ?)')->execute([$rid, $delta, trim((string)($input['reason'] ?? 'admin top-up')), 'admin']);
    $balStmt = $db->prepare('SELECT credits_balance FROM resellers WHERE id = ? LIMIT 1');
    $balStmt->execute([$rid]);
    json_response(['success' => true, 'credits_balance' => (int)($balStmt->fetchColumn() ?: 0)]);
}

// Route: GET /api/admin/audit-logs
if ($path === '/api/admin/audit-logs' && $method === 'GET') {
    $limit = min(100, max(1, (int)($_GET['limit'] ?? 50)));
    $stmt = $db->prepare("SELECT * FROM subscription_audit_logs ORDER BY id DESC LIMIT {$limit}");
    $stmt->execute();
    json_response(['success' => true, 'logs' => $stmt->fetchAll()]);
}

// Route: DELETE /api/admin/audit-logs (clear all audit entries)
if ($path === '/api/admin/audit-logs' && $method === 'DELETE') {
    $input = get_json_input();
    if (empty($input['confirm'])) {
        json_response(['success' => false, 'error' => ['code' => 'CONFIRM_REQUIRED', 'message' => 'Send confirm: true to clear the audit log.']], 400);
    }
    $db->exec('DELETE FROM subscription_audit_logs');
    json_response(['success' => true, 'message' => 'Audit log cleared.']);
}

// -------------------------------------------------------------
// 404 Route Not Found
// -------------------------------------------------------------
json_response([
    'success' => false,
    'error' => [
        'code' => 'NOT_FOUND',
        'message' => "The requested route '{$method} {$path}' was not found on this server."
    ]
], 404);
