import paramiko
import os

def deploy_web(local_dir, remote_dir):
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect('194.164.64.35', port=65002, username='u139837297', password='@@Jhon__mosses12311', timeout=25)
    sftp = ssh.open_sftp()
    
    print(f"Deploying {local_dir} -> {remote_dir}")
    for root, dirs, files in os.walk(local_dir):
        rel_path = os.path.relpath(root, local_dir)
        curr_remote = remote_dir if rel_path == '.' else os.path.join(remote_dir, rel_path).replace('\\', '/')
        
        try:
            sftp.mkdir(curr_remote)
        except:
            pass
            
        for file in files:
            local_file = os.path.join(root, file)
            remote_file = os.path.join(curr_remote, file).replace('\\', '/')
            print(f"Uploading {file} -> {remote_file}")
            sftp.put(local_file, remote_file)
            
    sftp.close()
    ssh.close()
    print("Web Deployment finished successfully!")

if __name__ == '__main__':
    deploy_web('d:\\app-exp\\server-web', '/home/u139837297/domains/foxplayer.app/public_html')
