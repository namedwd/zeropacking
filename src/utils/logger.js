// logger.js - Winston 로거 설정
const winston = require('winston');
const path = require('path');

// 로그 레벨 설정
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
};

// 로그 레벨 색상
const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'white',
};

winston.addColors(colors);

// 로그 포맷 정의
const format = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
    winston.format.colorize({ all: true }),
    winston.format.printf(
        (info) => `${info.timestamp} ${info.level}: ${info.message}`,
    ),
);

// 트랜스포트 정의
const transports = [
    // 콘솔 출력
    new winston.transports.Console(),
    
    // 에러 로그 파일
    new winston.transports.File({
        filename: path.join('logs', 'error.log'),
        level: 'error',
    }),
    
    // 전체 로그 파일
    new winston.transports.File({
        filename: path.join('logs', 'all.log'),
    }),
];

// 로거 생성
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    levels,
    format,
    transports,
});

module.exports = logger;
