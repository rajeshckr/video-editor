const express = require('express');

const router = express.Router();
const clientsByUploadId = new Map();
const lastEventByUploadId = new Map();

function writeEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

router.get('/:uploadId', (req, res) => {
  const { uploadId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clients = clientsByUploadId.get(uploadId) || new Set();
  clients.add(res);
  clientsByUploadId.set(uploadId, clients);

  const lastEvent = lastEventByUploadId.get(uploadId);
  if (lastEvent) {
    writeEvent(res, lastEvent);
  } else {
    writeEvent(res, {
      type: 'connected',
      step: 'waiting',
      message: 'Connected to progress stream',
      progress: 0
    });
  }

  req.on('close', () => {
    const activeClients = clientsByUploadId.get(uploadId);
    if (!activeClients) {
      return;
    }

    activeClients.delete(res);
    if (activeClients.size === 0) {
      clientsByUploadId.delete(uploadId);
    }
  });
});

router.sendProgress = (uploadId, payload) => {
  lastEventByUploadId.set(uploadId, payload);

  const clients = clientsByUploadId.get(uploadId);
  if (!clients || clients.size === 0) {
    return;
  }

  for (const client of clients) {
    writeEvent(client, payload);
  }
};

router.complete = (uploadId) => {
  const clients = clientsByUploadId.get(uploadId);

  if (clients && clients.size > 0) {
    for (const client of clients) {
      client.end();
    }
  }

  clientsByUploadId.delete(uploadId);

  // Retain terminal state briefly so late subscribers can still read completion.
  setTimeout(() => {
    lastEventByUploadId.delete(uploadId);
  }, 5 * 60 * 1000);
};

module.exports = router;
