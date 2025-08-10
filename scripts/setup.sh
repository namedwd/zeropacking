#!/bin/bash
# scripts/setup.sh - 초기 서버 설정 스크립트

echo "🚀 Starting ZeroPacking Server Setup..."

# 색상 코드
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 시스템 업데이트
echo -e "${YELLOW}Updating system packages...${NC}"
sudo apt update && sudo apt upgrade -y

# Node.js 18.x 설치
echo -e "${YELLOW}Installing Node.js 18.x...${NC}"
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Git 설치
echo -e "${YELLOW}Installing Git...${NC}"
sudo apt-get install -y git

# PM2 설치
echo -e "${YELLOW}Installing PM2...${NC}"
sudo npm install -g pm2

# Nginx 설치
echo -e "${YELLOW}Installing Nginx...${NC}"
sudo apt-get install -y nginx

# 로그 디렉토리 생성
echo -e "${YELLOW}Creating log directory...${NC}"
mkdir -p logs

# 환경변수 파일 생성
if [ ! -f .env ]; then
    echo -e "${YELLOW}Creating .env file...${NC}"
    cp .env.example .env
    echo -e "${RED}Please edit .env file with your actual values!${NC}"
fi

# 의존성 설치
echo -e "${YELLOW}Installing dependencies...${NC}"
npm install

# PM2 시작 스크립트 설정
echo -e "${YELLOW}Setting up PM2...${NC}"
pm2 startup systemd -u ubuntu --hp /home/ubuntu

echo -e "${GREEN}✅ Setup completed!${NC}"
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Edit .env file with your actual values"
echo "2. Configure Nginx (see nginx.conf example)"
echo "3. Run: npm start or pm2 start ecosystem.config.js"
