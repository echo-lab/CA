# Setting up EC2 deployment (using elastic ip / no domain)

## Create an instace:

- Name: Jennie Server (optional)
- Amazon Machine Image: Ubuntu
- Instance type: t3.small
- Key pair: create a new key-pair and keep it safe
- Network settings:
  - Name your security group and describe accordingly
  - Inbound Security Group Rules:
    1. Type: ssh, Source type: My IP
    2. Type: HTTP, Source type: Anywhere
    3. Type: HTTPS, Source type: Anywhere

-> Launch instance

## Setting elastic IP

( Ensure that the instance is stopped before doing this )

- Topleft drop down menu -> Network & Security -> Elastic IP -> Allocate Elastic IP address -> Allocate (keep defaults)
- Click on the allocated IP address then associate with the created instance (i.e. Jennie Server)

## SSH onto VM

- `ssh -i mykey.pem ubuntu@<elastic-ip>`

## Setting up the repo on EC2 instance

### Downloading node.js with npm

`curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash`
`\. "$HOME/.nvm/nvm.sh"`
`nvm install 24`

### Clone the repo

- `git clone https://github.com/echo-lab/CA.git`

### Backend

- Downloading dependencies for backend
  `cd ./CA/server && npm install`

- Copies the contents of the .env.local (on your machine) to ec2 instance:
  `scp -i mykey.pem server/.env.local ubuntu@<elastic-ip>:~/CA/server/.env.local`
  Alternative: use nano to edit ./server/.env.local

- Ensure `./CA/.key/key.json` exist locally then copy to ec2 instance
- Ensure `./CA/server/participants.json` exists and is filled in (refer README.md and setup_local_test.md)

### Frontend

- Downloading dependencies for frontend
  `cd ./CA/ && npm install`
- Create and copy `.CA/build` folder to EC2 instance
  `REACT_APP_API_BASE=/api npm run build`
  `scp -i mykey.pem -r build ubuntu@<elastic-ip>:~/CA/build`

### Deploying with Caddy

`sudo mkdir -p /var/www/app`
`sudo cp -r ./CA/build/* /var/www/app/`

- Generate domain using public IP not using cert:
  `dig +short <ip-with-dashes>.sslip.io ` should print the Elastic IP
  (i.e. for ip-with-dashes: 0.0.0.0 -> 0-0-0-0)

#### Caddyfile

`sudo nano /etc/caddy/Caddyfile`

```
<ip-with-dashes>.sslip.io {
    handle_path /api/* {
        reverse_proxy localhost:5004
    }

    handle {
        root * /var/www/app
        try_files {path} /index.html
        file_server
    }
}
```

- Apply changes:
  `caddy validate --config /etc/caddy/Caddyfile`
  `sudo systemctl reload caddy`
  `sudo journalctl -u caddy -f` # look for "certificate obtained successfully"
  (the terminal might stall at a warning, just terminate using Ctrl+C)

# Testing:

`https://<ip-with-dashes>.sslip.io`
