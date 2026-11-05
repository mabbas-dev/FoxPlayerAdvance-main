import paramiko

def run_ssh_command(cmd):
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect('194.164.64.35', port=65002, username='u139837297', password='@@Jhon__mosses12311', timeout=15)
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='ignore')
    err = stderr.read().decode('utf-8', errors='ignore')
    ssh.close()
    return out, err

if __name__ == '__main__':
    run_ssh_command("echo '<?php echo \"FOXPLAYER_WEB_OK\"; ?>' > /home/u139837297/domains/foxplayer.app/public_html/index.php")
    run_ssh_command("echo '<?php echo \"FOXPLAYER_API_OK\"; ?>' > /home/u139837297/domains/api.foxplayer.app/public_html/index.php")
    print("Files written. Testing URLs...")
