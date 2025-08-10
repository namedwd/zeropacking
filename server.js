// server.js - 메인 서버 파일
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

// 라우터 임포트
const authRoutes = require('./src/routes/auth');
const uploadRoutes = require('./src/routes/upload');
const recordingRoutes = require('./src/routes/recording');
const videoRoutes = require('./src/routes/video');

// 로거 설정
const logger = require('./src/utils/logger');

// Express 앱 생성
const app = express();
const PORT = process.env.PORT || 3001;

// 보안 미들웨어
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS 설정
app.use(cors({
    origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15분
    max: 100, // 최대 100 요청
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// 업로드 전용 Rate limiting (더 관대하게)
const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: 'Too many upload requests'
});
app.use('/api/upload/', uploadLimiter);

// 미들웨어
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) }}));

// 정적 파일 서빙 (public 폴더)
app.use('/public', express.static(path.join(__dirname, 'public')));

// 헬스 체크
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// API 라우트
app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/recording', recordingRoutes);
app.use('/api/video', videoRoutes);

// 404 핸들러
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// 에러 핸들러
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    
    // 에러 응답
    res.status(err.status || 500).json({
        error: process.env.NODE_ENV === 'production' 
            ? 'Internal server error' 
            : err.message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
});

// 서버 시작
const server = app.listen(PORT, () => {
    logger.info(`🚀 Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    logger.info('SIGINT signal received: closing HTTP server');
    server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
    });
});

// 처리되지 않은 에러 핸들링
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

module.exports = app;
