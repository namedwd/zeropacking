// cloudinary.js - Cloudinary 업로드 라우터
const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');
const logger = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');

// Cloudinary 설정
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer 설정 (메모리 저장)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB 제한
    }
});

// 청크 업로드를 위한 임시 저장소
const uploadSessions = new Map();

/**
 * 업로드 세션 시작
 */
router.post('/start-upload', authenticateToken, async (req, res) => {
    try {
        const { fileName, fileSize, totalChunks, recordingId } = req.body;
        const sessionId = `${req.user.worker_id}_${recordingId}_${Date.now()}`;
        
        // 세션 정보 저장
        uploadSessions.set(sessionId, {
            fileName,
            fileSize,
            totalChunks,
            chunks: [],
            recordingId,
            workerId: req.user.worker_id,
            companyId: req.user.company_id,
            createdAt: new Date()
        });

        // 30분 후 자동 정리
        setTimeout(() => {
            if (uploadSessions.has(sessionId)) {
                uploadSessions.delete(sessionId);
                logger.warn(`Upload session ${sessionId} expired`);
            }
        }, 30 * 60 * 1000);

        res.json({ 
            success: true, 
            sessionId,
            message: 'Upload session started'
        });
    } catch (error) {
        logger.error('Start upload error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * 청크 업로드
 */
router.post('/upload-chunk', authenticateToken, upload.single('chunk'), async (req, res) => {
    try {
        const { sessionId, chunkIndex, totalChunks } = req.body;
        const session = uploadSessions.get(sessionId);
        
        if (!session) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid or expired session' 
            });
        }

        // 청크 저장
        session.chunks[chunkIndex] = req.file.buffer;
        
        const uploadedChunks = session.chunks.filter(chunk => chunk !== undefined).length;
        const progress = (uploadedChunks / totalChunks) * 100;

        logger.info(`Chunk ${chunkIndex + 1}/${totalChunks} uploaded for session ${sessionId}`);

        // 모든 청크가 업로드되면 Cloudinary에 전송
        if (uploadedChunks === parseInt(totalChunks)) {
            const completeBuffer = Buffer.concat(session.chunks);
            
            // Cloudinary 업로드
            const uploadResult = await uploadToCloudinary(
                completeBuffer,
                session.fileName,
                session.recordingId,
                session.companyId
            );

            // 세션 정리
            uploadSessions.delete(sessionId);

            return res.json({
                success: true,
                complete: true,
                cloudinaryUrl: uploadResult.secure_url,
                publicId: uploadResult.public_id,
                message: 'Upload completed successfully'
            });
        }

        res.json({
            success: true,
            progress,
            uploadedChunks,
            totalChunks: parseInt(totalChunks)
        });
    } catch (error) {
        logger.error('Chunk upload error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * 직접 업로드 (작은 파일용)
 */
router.post('/upload-direct', authenticateToken, upload.single('video'), async (req, res) => {
    try {
        const { recordingId } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                error: 'No file provided' 
            });
        }

        // Cloudinary 업로드
        const uploadResult = await uploadToCloudinary(
            req.file.buffer,
            req.file.originalname,
            recordingId,
            req.user.company_id
        );

        res.json({
            success: true,
            cloudinaryUrl: uploadResult.secure_url,
            publicId: uploadResult.public_id,
            format: uploadResult.format,
            duration: uploadResult.duration,
            size: uploadResult.bytes
        });
    } catch (error) {
        logger.error('Direct upload error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * Cloudinary에 업로드하는 헬퍼 함수
 */
function uploadToCloudinary(buffer, fileName, recordingId, companyId) {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                resource_type: 'video',
                folder: `zeropacking/${companyId}/recordings`,
                public_id: `${recordingId}_${Date.now()}`,
                overwrite: true,
                notification_url: process.env.CLOUDINARY_WEBHOOK_URL,
                eager: [
                    { width: 300, height: 300, crop: 'pad', audio_codec: 'none' },
                    { width: 160, height: 90, crop: 'pad', audio_codec: 'none', format: 'png' }
                ],
                eager_async: true,
                tags: [`recording_${recordingId}`, `company_${companyId}`]
            },
            (error, result) => {
                if (error) {
                    logger.error('Cloudinary upload error:', error);
                    reject(error);
                } else {
                    logger.info('Cloudinary upload success:', result.public_id);
                    resolve(result);
                }
            }
        );

        const stream = Readable.from(buffer);
        stream.pipe(uploadStream);
    });
}

/**
 * 업로드 상태 확인
 */
router.get('/upload-status/:sessionId', authenticateToken, (req, res) => {
    const session = uploadSessions.get(req.params.sessionId);
    
    if (!session) {
        return res.status(404).json({ 
            success: false, 
            error: 'Session not found' 
        });
    }

    const uploadedChunks = session.chunks.filter(chunk => chunk !== undefined).length;
    const progress = (uploadedChunks / session.totalChunks) * 100;

    res.json({
        success: true,
        progress,
        uploadedChunks,
        totalChunks: session.totalChunks,
        fileName: session.fileName
    });
});

/**
 * 업로드 취소
 */
router.delete('/cancel-upload/:sessionId', authenticateToken, (req, res) => {
    const sessionId = req.params.sessionId;
    
    if (uploadSessions.has(sessionId)) {
        uploadSessions.delete(sessionId);
        logger.info(`Upload session ${sessionId} cancelled`);
        
        res.json({ 
            success: true, 
            message: 'Upload cancelled' 
        });
    } else {
        res.status(404).json({ 
            success: false, 
            error: 'Session not found' 
        });
    }
});

module.exports = router;
