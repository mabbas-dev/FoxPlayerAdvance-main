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
    out, err = run_ssh_command("mysql -u u139837297_fox_db -p'6pXeaXlP@' -h localhost -e 'SELECT DATABASE(), VERSION();' u139837297_fox_db")
    print("Localhost stdout:\n", out)
    print("Localhost stderr:\n", err)
