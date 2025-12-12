import { Router, Request, Response } from 'express';
import whatsappAutomationService from '../services/whatsapp-automation.service';
import { prisma } from '../utils/db';
import { createChildLogger } from '../utils/logger';

const router = Router();
const logger = createChildLogger('contact-routes');

/**
 * POST /api/contacts/create
 * Create a WhatsApp contact via UI automation
 */
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { sessionId, phoneNumber, firstName, lastName } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    if (!phoneNumber) {
      return res.status(400).json({ error: 'phoneNumber is required' });
    }

    // Get session to retrieve appiumPort
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (!session.appiumPort) {
      return res.status(400).json({ error: 'Session does not have an Appium port (not running)' });
    }

    if (!session.isActive) {
      return res.status(400).json({ error: 'Session is not active' });
    }

    logger.info({ sessionId, phoneNumber, firstName, lastName }, 'Creating WhatsApp contact via UI');

    // Call the automation service
    await whatsappAutomationService.createWhatsAppContact({
      appiumPort: session.appiumPort,
      sessionId: session.id,
      phoneNumber,
      firstName,
      lastName,
    });

    logger.info({ sessionId, phoneNumber }, 'WhatsApp contact created successfully');

    return res.status(200).json({
      success: true,
      message: 'Contact créé avec succès',
      contact: {
        firstName,
        lastName,
        phoneNumber,
      },
    });

  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to create WhatsApp contact');
    return res.status(500).json({
      error: 'Failed to create contact',
      details: error.message,
    });
  }
});

export default router;

