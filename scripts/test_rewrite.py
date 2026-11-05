import paramiko
import urllib.request
import ssl
import time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('194.164.64.35', port=65002, username='u139837297', password='@@Jhon__mosses12311', timeout=15)

sftp = ssh.open_sftp()

htaccess_content = """RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^(.*)$ index.php [QSA,L]
"""

with sftp.file('/home/u139837297/domains/api.foxplayer.app/public_html/.htaccess', 'w') as f:
    f.write(htaccess_content)

index_content = """<?php
header('Content-Type: application/json');
echo json_encode([
    'success' => true,
    'uri' => $_SERVER['REQUEST_URI'] ?? '',
    'method' => $_SERVER['REQUEST_METHOD'] ?? ''
]);
"""

with sftp.file('/home/u139837297/domains/api.foxplayer.app/public_html/index.php', 'w') as f:
    f.write(index_content)

sftp.close()
ssh.close()

time.sleep(1)

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

req = urllib.request.Request('https://api.foxplayer.app/v1/devices/status/TEST1234', headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=5, context=ctx) as response:
    print('URL rewrite response:', response.status, response.read().decode())
