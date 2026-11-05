import paramiko

def execute_sql_on_remote(sql):
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect('194.164.64.35', port=65002, username='u139837297', password='@@Jhon__mosses12311', timeout=20)
    
    sftp = ssh.open_sftp()
    with sftp.file('/home/u139837297/init_schema.sql', 'w') as f:
        f.write(sql)
    sftp.close()

    cmd = "mysql -u u139837297_fox_db -p'6pXeaXlP@' -h localhost u139837297_fox_db < /home/u139837297/init_schema.sql"
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='ignore')
    err = stderr.read().decode('utf-8', errors='ignore')
    
    # check tables
    stdin, stdout, stderr = ssh.exec_command("mysql -u u139837297_fox_db -p'6pXeaXlP@' -h localhost -e 'SHOW TABLES;' u139837297_fox_db")
    tables = stdout.read().decode('utf-8', errors='ignore')
    
    ssh.close()
    return out, err, tables

SCHEMA_SQL = """
-- FOX PLAYER Production MySQL Schema

CREATE TABLE IF NOT EXISTS devices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(64) NOT NULL UNIQUE,
    mac_address VARCHAR(32) NULL,
    management_key VARCHAR(64) NULL,
    id_lock TINYINT(1) NOT NULL DEFAULT 0,
    pairing_code VARCHAR(32) NULL,
    pairing_token VARCHAR(128) NULL,
    pairing_token_expires_at DATETIME NULL,
    session_token VARCHAR(128) NULL,
    session_token_expires_at DATETIME NULL,
    installation_id VARCHAR(64) NULL UNIQUE,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    app_version VARCHAR(32) NULL,
    ip_address VARCHAR(64) NULL,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_dev_mac (mac_address),
    INDEX idx_dev_status (status),
    INDEX idx_dev_last_seen (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS playlists (
    id INT AUTO_INCREMENT PRIMARY KEY,
    type ENUM('m3u', 'xtream') NOT NULL,
    playlist_url TEXT NULL,
    server_url TEXT NULL,
    username VARCHAR(255) NULL,
    password_encrypted TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_playlists_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS device_playlists (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(64) NOT NULL,
    playlist_id INT NOT NULL,
    playlist_name VARCHAR(255) NOT NULL DEFAULT 'Default Playlist',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    last_used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_dp_device (device_id),
    INDEX idx_dp_active (device_id, is_active),
    UNIQUE KEY idx_device_playlist_uniq (device_id, playlist_id),
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscription_settings (
    id INT PRIMARY KEY,
    trial_enabled TINYINT(1) NOT NULL DEFAULT 1,
    trial_duration_days INT NOT NULL DEFAULT 7,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(64) DEFAULT 'system',
    notes TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO subscription_settings (id, trial_enabled, trial_duration_days, updated_by, notes)
VALUES (1, 1, 7, 'system', 'Default free trial configuration')
ON DUPLICATE KEY UPDATE id=id;

CREATE TABLE IF NOT EXISTS subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    installation_id VARCHAR(64) NULL,
    device_id VARCHAR(64) NOT NULL,
    subscription_type VARCHAR(32) NOT NULL DEFAULT 'trial',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    starts_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    duration_days INT NOT NULL DEFAULT 7,
    source VARCHAR(64) NOT NULL DEFAULT 'auto_trial',
    notes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sub_device (device_id),
    INDEX idx_sub_installation (installation_id),
    INDEX idx_sub_status (status),
    INDEX idx_sub_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS playlist_sync_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(64) NOT NULL,
    synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status ENUM('success', 'failed') NOT NULL,
    channels_count INT DEFAULT 0,
    movies_count INT DEFAULT 0,
    series_count INT DEFAULT 0,
    error_message TEXT NULL,
    duration_ms INT NULL,
    INDEX idx_sync_device (device_id),
    INDEX idx_sync_time (synced_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscription_audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(64) NOT NULL,
    target_id VARCHAR(128) NULL,
    performed_by VARCHAR(64) NOT NULL DEFAULT 'admin',
    details TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

if __name__ == '__main__':
    print("Running MySQL migration...")
    out, err, tables = execute_sql_on_remote(SCHEMA_SQL)
    print("OUT:", out)
    if err:
        print("ERR:", err)
    print("TABLES IN u139837297_fox_db:")
    print(tables)
