import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('194.164.64.35', port=65002, username='u139837297', password='@@Jhon__mosses12311', timeout=20)
ssh.exec_command("mysql -u u139837297_fox_db -p'6pXeaXlP@' -h localhost -e \"DELETE FROM devices WHERE device_id IN ('FOXTEST99', 'INSIDE%20APP%20LOGO.PNG');\" u139837297_fox_db")
ssh.close()
print("Cleaned up!")
