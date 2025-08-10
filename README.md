# ZeroPacking Server

물류 영상 녹화 시스템의 백엔드 API 서버입니다.

## 기능

- 작업자 인증 (JWT)
- S3 직접 업로드 (Presigned URL)
- Multipart 업로드 지원
- 녹화 세션 관리
- Supabase 데이터베이스 연동

## 설치

```bash
# 의존성 설치
npm install

# 환경변수 설정
cp .env.example .env
# .env 파일을 실제 값으로 수정

# 개발 모드 실행
npm run dev

# 프로덕션 모드 실행
npm start
```

## API 엔드포인트

### 인증
- `POST /api/auth/worker/login` - 작업자 로그인
- `POST /api/auth/verify` - 토큰 검증
- `GET /api/auth/companies` - 회사 목록

### 업로드
- `POST /api/upload/presigned-url` - 단일 파일 업로드 URL
- `POST /api/upload/multipart/init` - Multipart 업로드 시작
- `POST /api/upload/multipart/part-url` - 파트 업로드 URL
- `POST /api/upload/multipart/complete` - Multipart 업로드 완료

### 녹화
- `POST /api/recording/start` - 녹화 시작
- `POST /api/recording/end` - 녹화 종료
- `PATCH /api/recording/:id/status` - 상태 업데이트
- `GET /api/recording/list` - 녹화 목록

## 배포 (AWS Lightsail)

```bash
# 서버 설정
chmod +x scripts/setup.sh
./scripts/setup.sh

# 배포
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

## 환경변수

`.env.example` 파일을 참고하여 실제 값으로 설정하세요.

## 라이선스

ISC
