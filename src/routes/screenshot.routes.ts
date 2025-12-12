import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('screenshot-routes');
const router = Router();

/**
 * GET /api/screenshots/:sessionId/list
 * List all screenshots for a session
 */
router.get('/:sessionId/list', async (req, res): Promise<any> => {
  try {
    const { sessionId } = req.params;

    // Try Docker volume path first, then local path
    const dockerPath = `/data/screenshots/${sessionId}`;
    const localPath = path.join(process.cwd(), 'data', 'screenshots', sessionId);
    
    const screenshotDir = fs.existsSync('/data/screenshots') ? dockerPath : localPath;

    if (!fs.existsSync(screenshotDir)) {
      return res.json({ screenshots: [] });
    }

    // Get all PNG files
    const files = fs.readdirSync(screenshotDir)
      .filter(file => file.endsWith('.png'))
      .map(file => ({
        name: file,
        time: fs.statSync(path.join(screenshotDir, file)).mtime.getTime()
      }))
      .sort((a, b) => a.time - b.time); // Oldest first

    res.json({ screenshots: files.map(f => f.name) });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to list screenshots');
    res.status(500).json({ error: 'Failed to list screenshots' });
  }
});

/**
 * GET /api/screenshots/:sessionId/latest
 * Get the latest screenshot for a session
 * IMPORTANT: This MUST be before /:sessionId/:filename to avoid matching "latest" as a filename
 */
router.get('/:sessionId/latest', async (req, res): Promise<any> => {
  try {
    const { sessionId } = req.params;

    // Try Docker volume path first, then local path
    const dockerPath = `/data/screenshots/${sessionId}`;
    const localPath = path.join(process.cwd(), 'data', 'screenshots', sessionId);
    
    const screenshotDir = fs.existsSync('/data/screenshots') ? dockerPath : localPath;

    if (!fs.existsSync(screenshotDir)) {
      return res.status(404).json({ error: 'No screenshots found' });
    }

    // Get all PNG files
    const files = fs.readdirSync(screenshotDir)
      .filter(file => file.endsWith('.png'))
      .map(file => ({
        name: file,
        path: path.join(screenshotDir, file),
        time: fs.statSync(path.join(screenshotDir, file)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time); // Most recent first

    if (files.length === 0) {
      return res.status(404).json({ error: 'No screenshots found' });
    }

    const latestFile = files[0];
    
    // CORS headers for images - allow frontend to load them
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // CRITICAL: Cross-Origin-Resource-Policy to fix "blocked:CORP" error
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    
    // Return image
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(latestFile.path);

  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to get latest screenshot');
    res.status(500).json({ error: 'Failed to get screenshot' });
  }
});

/**
 * GET /api/screenshots/:sessionId/:filename
 * Get a specific screenshot by filename
 */
router.get('/:sessionId/:filename', async (req, res): Promise<any> => {
  try {
    const { sessionId, filename } = req.params;

    // Security: prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    // Ensure .png extension
    if (!filename.endsWith('.png')) {
      return res.status(400).json({ error: 'Only PNG files are allowed' });
    }

    // Try Docker volume path first, then local path
    const dockerPath = `/data/screenshots/${sessionId}/${filename}`;
    const localPath = path.join(process.cwd(), 'data', 'screenshots', sessionId, filename);
    
    const filePath = fs.existsSync('/data/screenshots') ? dockerPath : localPath;

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Screenshot not found' });
    }

    // CORS headers for images - allow frontend to load them
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // CRITICAL: Cross-Origin-Resource-Policy to fix "blocked:CORP" error
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    
    // Return image
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(filePath);
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to get screenshot');
    res.status(500).json({ error: 'Failed to get screenshot' });
  }
});

export default router;

