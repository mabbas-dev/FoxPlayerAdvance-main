<?php
// FOX PLAYER Production API Configuration — PHP 8.2 & MariaDB / MySQL
declare(strict_types=1);

// Database configuration
define('DB_HOST', 'localhost');
define('DB_NAME', 'u139837297_fox_db');
define('DB_USER', 'u139837297_fox_db');
define('DB_PASS', '6pXeaXlP@');
define('DB_CHARSET', 'utf8mb4');

// Security secrets
define('ENCRYPTION_KEY', hash('sha256', 'FOX_PLAYER_CIPHER_KEY_2026_PRODUCTION_SECURE'));
define('ADMIN_SECRET', 'fox_admin_2026');

/**
 * Get singleton PDO instance
 */
function get_db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s', DB_HOST, DB_NAME, DB_CHARSET);
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_PERSISTENT         => false,
        ];
        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
        } catch (PDOException $e) {
            json_response([
                'success' => false,
                'error' => [
                    'code' => 'DB_CONNECTION_FAILED',
                    'message' => 'Database connection failed: ' . $e->getMessage()
                ]
            ], 500);
            exit;
        }
    }
    return $pdo;
}

/**
 * JSON Response helper
 */
function json_response(array $data, int $statusCode = 200): void {
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Read JSON input payload
 */
function get_json_input(): array {
    $raw = file_get_contents('php://input');
    if (empty($raw)) {
        return $_POST ?? [];
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

/**
 * Encrypt sensitive credentials (e.g. Xtream passwords)
 */
function encrypt_secret(?string $plain): ?string {
    if ($plain === null || $plain === '') return null;
    $iv = openssl_random_pseudo_bytes(16);
    $encrypted = openssl_encrypt($plain, 'AES-256-CBC', ENCRYPTION_KEY, 0, $iv);
    return base64_encode($iv . $encrypted);
}

/**
 * Decrypt sensitive credentials
 */
function decrypt_secret(?string $cipher): ?string {
    if ($cipher === null || $cipher === '') return null;
    $raw = base64_decode($cipher);
    if (strlen($raw) < 17) return $cipher; // fallback if plain
    $iv = substr($raw, 0, 16);
    $data = substr($raw, 16);
    $decrypted = openssl_decrypt($data, 'AES-256-CBC', ENCRYPTION_KEY, 0, $iv);
    return ($decrypted !== false) ? $decrypted : $cipher;
}

/**
 * Encrypt full API response payload with AES-256-CBC (compatible with FOX PLAYER React Native app)
 * Output format: Base64(16-byte random IV + raw ciphertext)
 */
function encrypt_payload(mixed $data): string {
    $plain = is_string($data) ? $data : json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $iv = openssl_random_pseudo_bytes(16);
    $key = hash('sha256', 'FOX_PLAYER_CIPHER_KEY_2026_PRODUCTION_SECURE', true);
    $cipher = openssl_encrypt($plain, 'AES-256-CBC', $key, OPENSSL_RAW_DATA, $iv);
    return base64_encode($iv . $cipher);
}

/**
 * Decrypt full API payload
 */
function decrypt_payload(string $base64): mixed {
    $raw = base64_decode($base64);
    if (strlen($raw) < 17) return null;
    $iv = substr($raw, 0, 16);
    $cipher = substr($raw, 16);
    $key = hash('sha256', 'FOX_PLAYER_CIPHER_KEY_2026_PRODUCTION_SECURE', true);
    $plain = openssl_decrypt($cipher, 'AES-256-CBC', $key, OPENSSL_RAW_DATA, $iv);
    if ($plain === false) return null;
    $decoded = json_decode($plain, true);
    return ($decoded !== null) ? $decoded : $plain;
}


/**
 * Normalize device ID / MAC address
 */
function normalize_device_id(string $id): string {
    $cleaned = strtoupper(trim($id));
    return $cleaned;
}

/**
 * Normalize IPTV server URL for comparison (bulk replace, dedupe).
 */
function normalize_server_url_compare(string $url): string {
    $url = trim($url);
    if ($url === '') {
        return '';
    }
    if (!preg_match('#^https?://#i', $url)) {
        $url = 'http://' . $url;
    }
    $url = preg_replace('#/player_api\.php(\?.*)?$#i', '', $url);
    $url = preg_replace('#/get\.php(\?.*)?$#i', '', $url);
    return strtolower(rtrim($url, '/'));
}

/**
 * Verify admin authorization token
 */
function verify_admin(): bool {
    $headers = getallheaders();
    $auth = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    $token = $headers['x-admin-key'] ?? $headers['x-admin-token'] ?? ($_GET['admin_token'] ?? null);

    if (empty($token) && !empty($auth) && str_starts_with($auth, 'Bearer ')) {
        $token = trim(substr($auth, 7));
    }

    if ($token === ADMIN_SECRET) {
        return true;
    }

    // Check session in db if any
    if (!empty($token)) {
        try {
            $db = get_db();
            $stmt = $db->prepare("SELECT id FROM admins WHERE password_hash = ?");
            $stmt->execute([$token]);
            if ($stmt->fetch()) return true;
        } catch (Exception $e) {}
    }

    return false;
}

/**
 * Platform control tables (app versions, credit plans, resellers).
 */
function ensure_platform_control_schema(PDO $db): void {
    static $ensured = false;
    if ($ensured) {
        return;
    }
    $ensured = true;

    $db->exec("
        CREATE TABLE IF NOT EXISTS app_versions (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            platform VARCHAR(16) NOT NULL DEFAULT 'all',
            version_name VARCHAR(32) NOT NULL,
            version_code INT NOT NULL DEFAULT 1,
            is_required TINYINT(1) NOT NULL DEFAULT 0,
            store_url VARCHAR(512) DEFAULT NULL,
            release_notes TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_platform_version (platform, version_code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $db->exec("
        CREATE TABLE IF NOT EXISTS credit_plans (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            code VARCHAR(32) NOT NULL UNIQUE,
            label VARCHAR(128) NOT NULL,
            credits_cost INT NOT NULL DEFAULT 1,
            duration_days INT NOT NULL DEFAULT 30,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            sort_order INT NOT NULL DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $db->exec("
        CREATE TABLE IF NOT EXISTS resellers (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(64) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            display_name VARCHAR(128) DEFAULT NULL,
            credits_balance INT NOT NULL DEFAULT 0,
            api_token VARCHAR(128) DEFAULT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $db->exec("
        CREATE TABLE IF NOT EXISTS credit_ledger (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            reseller_id INT UNSIGNED NULL,
            delta INT NOT NULL,
            reason VARCHAR(255) DEFAULT NULL,
            actor VARCHAR(64) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_reseller (reseller_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $seed = $db->prepare('INSERT INTO credit_plans (code, label, credits_cost, duration_days, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)');
    $defaults = [
        ['month_1', '1 Month', 1, 30, 1],
        ['year_1', '1 Year', 2, 365, 2],
        ['forever', 'Lifetime / Forever', 10, 18250, 3],
    ];
    $exists = $db->prepare('SELECT id FROM credit_plans WHERE code = ? LIMIT 1');
    foreach ($defaults as $plan) {
        $exists->execute([$plan[0]]);
        if (!$exists->fetch()) {
            $seed->execute($plan);
        }
    }

    $verCount = (int)$db->query('SELECT COUNT(*) FROM app_versions')->fetchColumn();
    if ($verCount === 0) {
        $db->prepare('INSERT INTO app_versions (platform, version_name, version_code, is_required, store_url, release_notes) VALUES (?, ?, ?, 0, NULL, ?)')
            ->execute(['all', '1.0.0', 1, 'Baseline build — publish a higher build code in Admin → App versions to prompt updates.']);
    }
}

/** Reject playlist changes when the user locked the device ID in the app. */
function assert_device_unlocked(PDO $db, string $deviceId): void {
    $stmt = $db->prepare('SELECT id_lock FROM devices WHERE device_id = ? LIMIT 1');
    $stmt->execute([$deviceId]);
    $row = $stmt->fetch();
    if ($row && (int)$row['id_lock'] === 1) {
        json_response([
            'success' => false,
            'error' => [
                'code' => 'DEVICE_LOCKED',
                'message' => 'Device is locked in FOX PLAYER app settings. Unlock it in the app before uploading or changing playlists on the web.',
            ],
        ], 403);
    }
}

/**
 * Shipped app build — keep in sync with app.json (version, android.versionCode, ios.buildNumber, extra.appBuild).
 */
function fox_shipped_app_metadata(): array
{
    return [
        'version_name' => '1.0.0',
        'version_code' => 1,
        'android_version_code' => 1,
        'ios_build_number' => '1',
        'extra_app_build' => 1,
    ];
}

function json_encrypted_success(mixed $payload, int $status = 200): void {
    json_response([
        'success' => true,
        'encrypted' => true,
        'data' => encrypt_payload($payload),
    ], $status);
}

function verify_device_pairing_token(PDO $db, string $deviceId, string $token): ?array {
    if ($deviceId === '' || $token === '') {
        return null;
    }
    $stmt = $db->prepare('
        SELECT id, device_id, id_lock, pairing_token_expires_at
        FROM devices
        WHERE device_id = ? AND pairing_token = ?
        LIMIT 1
    ');
    $stmt->execute([$deviceId, $token]);
    $row = $stmt->fetch();
    if (!$row) {
        return null;
    }
    $exp = $row['pairing_token_expires_at'] ?? null;
    if ($exp && strtotime((string)$exp) < time()) {
        return null;
    }
    return $row;
}

function verify_reseller(PDO $db): ?array {
    $headers = getallheaders();
    $token = $headers['x-reseller-token'] ?? $headers['X-Reseller-Token'] ?? '';
    if ($token === '') {
        $auth = $headers['Authorization'] ?? $headers['authorization'] ?? '';
        if (str_starts_with($auth, 'Bearer ')) {
            $token = trim(substr($auth, 7));
        }
    }
    if ($token === '' && !empty($_GET['reseller_token'])) {
        $token = trim((string)$_GET['reseller_token']);
    }
    if ($token === '') {
        return null;
    }
    $stmt = $db->prepare('SELECT * FROM resellers WHERE api_token = ? AND is_active = 1 LIMIT 1');
    $stmt->execute([$token]);
    $row = $stmt->fetch();
    return $row ?: null;
}
