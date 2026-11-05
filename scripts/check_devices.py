import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('194.164.64.35', port=65002, username='u139837297', password='@@Jhon__mosses12311', timeout=20)
stdin, stdout, stderr = ssh.exec_command("mysql -u u139837297_fox_db -p'6pXeaXlP@' -h localhost -e 'SELECT id, device_id, mac_address, id_lock, status, created_at FROM devices LIMIT 20;' u139837297_fox_db")
print(stdout.read().decode())
ssh.close()
