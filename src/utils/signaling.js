/**
 * ============================================================
 *  AtikMeet - Signaling Server (Main Process)
 *  Socket.io-based signaling for WebRTC peer connections
 *  Handles room management, offer/answer, ICE candidates,
 *  chat, reactions, moderation, and recording events
 * ============================================================
 */

const { Server } = require('socket.io');

/**
 * Active rooms map
 * Key: roomId (string)
 * Value: {
 *   host: socketId,
 *   participants: Map<socketId, { userId, userName, isMuted, isCameraOff, isHandRaised, isScreenSharing }>,
 *   waitingRoom: Map<socketId, { userId, userName }>,
 *   isRecording: boolean,
 *   createdAt: Date
 * }
 */
const rooms = new Map();

/**
 * Socket-to-room mapping for quick lookups
 * Key: socketId, Value: roomId
 */
const socketRoomMap = new Map();

/**
 * Starts the Socket.io signaling server
 * @param {http.Server} httpServer - The HTTP server instance to attach to
 * @returns {Server} The Socket.io server instance
 */
function startSignalingServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  console.log('[Signaling] Socket.io signaling server initialized');

  io.on('connection', (socket) => {
    console.log(`[Signaling] Client connected: ${socket.id}`);

    // ── Join Room ──────────────────────────────────────────

    /**
     * Handles a client joining a meeting room
     * @event join-room
     * @param {Object} data - { roomId, userId, userName, isHost }
     */
    socket.on('join-room', (data) => {
      try {
        const { roomId, userId, userName, isHost } = data;

        if (!roomId || !userId || !userName) {
          socket.emit('error', { message: 'Missing required fields: roomId, userId, userName' });
          return;
        }

        // Create room if it doesn't exist
        if (!rooms.has(roomId)) {
          rooms.set(roomId, {
            host: isHost ? socket.id : null,
            participants: new Map(),
            waitingRoom: new Map(),
            isRecording: false,
            createdAt: new Date(),
          });
          console.log(`[Signaling] Room created: ${roomId}`);
        }

        const room = rooms.get(roomId);

        // Check participant limit (max 150)
        if (room.participants.size >= 150) {
          socket.emit('room-full', { message: 'This meeting has reached the maximum of 150 participants.' });
          return;
        }

        // If host, join directly. Otherwise, check if waiting room is needed
        if (isHost) {
          room.host = socket.id;
          _addParticipantToRoom(socket, room, roomId, userId, userName);
        } else if (room.host) {
          // If there's a host, send approval request
          _addParticipantToRoom(socket, room, roomId, userId, userName);
        } else {
          // No host yet, add to waiting room
          room.waitingRoom.set(socket.id, { userId, userName });
          socket.emit('waiting-approval', { message: 'Waiting for the host to admit you.' });
          // Notify host if connected
          if (room.host) {
            io.to(room.host).emit('approval-request', {
              socketId: socket.id,
              userId,
              userName,
            });
          }
        }
      } catch (error) {
        console.error('[Signaling] join-room error:', error.message);
        socket.emit('error', { message: 'Failed to join room.' });
      }
    });

    // ── Leave Room ─────────────────────────────────────────

    /**
     * Handles a client leaving a meeting room
     * @event leave-room
     * @param {Object} data - { roomId }
     */
    socket.on('leave-room', (data) => {
      try {
        const { roomId } = data || {};
        _handleLeaveRoom(socket, io, roomId || socketRoomMap.get(socket.id));
      } catch (error) {
        console.error('[Signaling] leave-room error:', error.message);
      }
    });

    // ── WebRTC Signaling ───────────────────────────────────

    /**
     * Relays WebRTC offer to a specific peer
     * @event offer
     * @param {Object} data - { targetId, sdp }
     */
    socket.on('offer', (data) => {
      try {
        const { targetId, sdp, offer, userName } = data;
        const relaySdp = sdp || offer;
        if (!targetId || !relaySdp) return;

        io.to(targetId).emit('offer', {
          senderId: socket.id,
          sdp: relaySdp,
          offer: relaySdp,
          senderName: userName
        });
      } catch (error) {
        console.error('[Signaling] offer error:', error.message);
      }
    });

    /**
     * Relays WebRTC answer to a specific peer
     * @event answer
     * @param {Object} data - { targetId, sdp }
     */
    socket.on('answer', (data) => {
      try {
        const { targetId, sdp, answer } = data;
        const relaySdp = sdp || answer;
        if (!targetId || !relaySdp) return;

        io.to(targetId).emit('answer', {
          senderId: socket.id,
          sdp: relaySdp,
          answer: relaySdp
        });
      } catch (error) {
        console.error('[Signaling] answer error:', error.message);
      }
    });

    /**
     * Relays ICE candidate to a specific peer
     * @event ice-candidate
     * @param {Object} data - { targetId, candidate }
     */
    socket.on('ice-candidate', (data) => {
      try {
        const { targetId, candidate } = data;
        if (!targetId || !candidate) return;

        io.to(targetId).emit('ice-candidate', {
          senderId: socket.id,
          candidate,
        });
      } catch (error) {
        console.error('[Signaling] ice-candidate error:', error.message);
      }
    });

    // ── Media Toggle Events ────────────────────────────────

    /**
     * Broadcasts audio toggle to all room participants
     * @event toggle-audio
     * @param {Object} data - { roomId, isMuted }
     */
    socket.on('toggle-audio', (data) => {
      try {
        const { roomId, isMuted } = data;
        const room = rooms.get(roomId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (participant) {
          participant.isMuted = isMuted;
        }

        socket.to(roomId).emit('participant-audio-toggled', {
          socketId: socket.id,
          isMuted,
        });
      } catch (error) {
        console.error('[Signaling] toggle-audio error:', error.message);
      }
    });

    /**
     * Broadcasts video toggle to all room participants
     * @event toggle-video
     * @param {Object} data - { roomId, isCameraOff }
     */
    socket.on('toggle-video', (data) => {
      try {
        const { roomId, isCameraOff } = data;
        const room = rooms.get(roomId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (participant) {
          participant.isCameraOff = isCameraOff;
        }

        socket.to(roomId).emit('participant-video-toggled', {
          socketId: socket.id,
          isCameraOff,
        });
      } catch (error) {
        console.error('[Signaling] toggle-video error:', error.message);
      }
    });

    // ── Screen Share ───────────────────────────────────────

    /**
     * Notifies room that a participant started screen sharing
     * @event screen-share
     * @param {Object} data - { roomId, isSharing }
     */
    socket.on('screen-share', (data) => {
      try {
        const { roomId, isSharing } = data;
        const room = rooms.get(roomId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (participant) {
          participant.isScreenSharing = isSharing;
        }

        socket.to(roomId).emit('screen-share-toggled', {
          socketId: socket.id,
          isSharing,
          userName: participant ? participant.userName : 'Unknown',
        });
      } catch (error) {
        console.error('[Signaling] screen-share error:', error.message);
      }
    });

    // ── Chat Message ───────────────────────────────────────

    /**
     * Broadcasts a chat message to all room participants
     * @event chat-message
     * @param {Object} data - { roomId, message, userName, userId, timestamp }
     */
    socket.on('chat-message', (data) => {
      try {
        const { roomId, message, userName, userId, timestamp } = data;
        if (!roomId || !message) return;

        const chatData = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          senderId: socket.id,
          userId: userId || 'unknown',
          userName: userName || 'Anonymous',
          message: message.trim(),
          timestamp: timestamp || new Date().toISOString(),
        };

        // Broadcast to all in room including sender
        io.in(roomId).emit('chat-message', chatData);
      } catch (error) {
        console.error('[Signaling] chat-message error:', error.message);
      }
    });

    // ── Reaction ───────────────────────────────────────────

    /**
     * Broadcasts a reaction emoji to all room participants
     * @event reaction
     * @param {Object} data - { roomId, emoji, userName }
     */
    socket.on('reaction', (data) => {
      try {
        const { roomId, emoji, userName } = data;
        if (!roomId || !emoji) return;

        socket.to(roomId).emit('reaction', {
          socketId: socket.id,
          emoji,
          userName: userName || 'Anonymous',
        });
      } catch (error) {
        console.error('[Signaling] reaction error:', error.message);
      }
    });

    // ── Hand Raise ─────────────────────────────────────────

    /**
     * Broadcasts hand raise toggle to all room participants
     * @event hand-raise
     * @param {Object} data - { roomId, isRaised, userName }
     */
    socket.on('hand-raise', (data) => {
      try {
        const { roomId, isRaised, userName } = data;
        if (!roomId) return;

        const room = rooms.get(roomId);
        if (room) {
          const participant = room.participants.get(socket.id);
          if (participant) {
            participant.isHandRaised = isRaised;
          }
        }

        socket.to(roomId).emit('hand-raised', {
          socketId: socket.id,
          isRaised,
          userName: userName || 'Anonymous',
        });
      } catch (error) {
        console.error('[Signaling] hand-raise error:', error.message);
      }
    });

    // ── Moderation Events (Host Only) ──────────────────────

    /**
     * Mutes a specific participant (host only)
     * @event mute-participant
     * @param {Object} data - { roomId, targetSocketId }
     */
    socket.on('mute-participant', (data) => {
      try {
        const { roomId, targetSocketId } = data;
        const room = rooms.get(roomId);
        if (!room || room.host !== socket.id) {
          socket.emit('error', { message: 'Only the host can mute participants.' });
          return;
        }

        const participant = room.participants.get(targetSocketId);
        if (participant) {
          participant.isMuted = true;
        }

        io.to(targetSocketId).emit('participant-muted', {
          by: 'host',
          message: 'You have been muted by the host.',
        });

        // Notify all participants
        socket.to(roomId).emit('participant-audio-toggled', {
          socketId: targetSocketId,
          isMuted: true,
        });
      } catch (error) {
        console.error('[Signaling] mute-participant error:', error.message);
      }
    });

    /**
     * Mutes all participants except the host
     * @event mute-all
     * @param {Object} data - { roomId }
     */
    socket.on('mute-all', (data) => {
      try {
        const { roomId } = data;
        const room = rooms.get(roomId);
        if (!room || room.host !== socket.id) {
          socket.emit('error', { message: 'Only the host can mute all participants.' });
          return;
        }

        room.participants.forEach((participant, socketId) => {
          if (socketId !== socket.id) {
            participant.isMuted = true;
            io.to(socketId).emit('participant-muted', {
              by: 'host',
              message: 'The host has muted everyone.',
            });
          }
        });

        io.in(roomId).emit('all-muted', { hostSocketId: socket.id });
      } catch (error) {
        console.error('[Signaling] mute-all error:', error.message);
      }
    });

    /**
     * Removes a participant from the meeting (host only)
     * @event remove-participant
     * @param {Object} data - { roomId, targetSocketId }
     */
    socket.on('remove-participant', (data) => {
      try {
        const { roomId, targetSocketId } = data;
        const room = rooms.get(roomId);
        if (!room || room.host !== socket.id) {
          socket.emit('error', { message: 'Only the host can remove participants.' });
          return;
        }

        // Notify the removed participant
        io.to(targetSocketId).emit('removed-from-meeting', {
          message: 'You have been removed from the meeting by the host.',
        });

        // Remove from room
        const targetSocket = io.sockets.sockets.get(targetSocketId);
        if (targetSocket) {
          targetSocket.leave(roomId);
        }

        const participant = room.participants.get(targetSocketId);
        room.participants.delete(targetSocketId);
        socketRoomMap.delete(targetSocketId);

        // Notify others
        socket.to(roomId).emit('user-left', {
          socketId: targetSocketId,
          userName: participant ? participant.userName : 'Unknown',
          participantCount: room.participants.size,
        });
      } catch (error) {
        console.error('[Signaling] remove-participant error:', error.message);
      }
    });

    // ── Waiting Room / Admit ───────────────────────────────

    /**
     * Admits a participant from the waiting room (host only)
     * @event admit-participant
     * @param {Object} data - { roomId, targetSocketId }
     */
    socket.on('admit-participant', (data) => {
      try {
        const { roomId, targetSocketId } = data;
        const room = rooms.get(roomId);
        if (!room || room.host !== socket.id) {
          socket.emit('error', { message: 'Only the host can admit participants.' });
          return;
        }

        const waitingUser = room.waitingRoom.get(targetSocketId);
        if (!waitingUser) {
          socket.emit('error', { message: 'User is no longer in the waiting room.' });
          return;
        }

        // Move from waiting room to participants
        room.waitingRoom.delete(targetSocketId);
        const targetSocket = io.sockets.sockets.get(targetSocketId);
        if (targetSocket) {
          _addParticipantToRoom(targetSocket, room, roomId, waitingUser.userId, waitingUser.userName);
          targetSocket.emit('admitted', { roomId });
        }
      } catch (error) {
        console.error('[Signaling] admit-participant error:', error.message);
      }
    });

    /**
     * Admits all participants from the waiting room (host only)
     * @event admit-all
     * @param {Object} data - { roomId }
     */
    socket.on('admit-all', (data) => {
      try {
        const { roomId } = data;
        const room = rooms.get(roomId);
        if (!room || room.host !== socket.id) {
          socket.emit('error', { message: 'Only the host can admit participants.' });
          return;
        }

        room.waitingRoom.forEach((waitingUser, waitingSocketId) => {
          const targetSocket = io.sockets.sockets.get(waitingSocketId);
          if (targetSocket) {
            _addParticipantToRoom(targetSocket, room, roomId, waitingUser.userId, waitingUser.userName);
            targetSocket.emit('admitted', { roomId });
          }
        });

        room.waitingRoom.clear();
      } catch (error) {
        console.error('[Signaling] admit-all error:', error.message);
      }
    });

    // ── Recording Events ───────────────────────────────────

    /**
     * Notifies all participants that recording has started
     * @event recording-start
     * @param {Object} data - { roomId }
     */
    socket.on('recording-start', (data) => {
      try {
        const { roomId } = data;
        const room = rooms.get(roomId);
        if (!room) return;

        room.isRecording = true;

        io.in(roomId).emit('recording-started', {
          startedBy: socket.id,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error('[Signaling] recording-start error:', error.message);
      }
    });

    /**
     * Notifies all participants that recording has stopped
     * @event recording-stop
     * @param {Object} data - { roomId }
     */
    socket.on('recording-stop', (data) => {
      try {
        const { roomId } = data;
        const room = rooms.get(roomId);
        if (!room) return;

        room.isRecording = false;

        io.in(roomId).emit('recording-stopped', {
          stoppedBy: socket.id,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error('[Signaling] recording-stop error:', error.message);
      }
    });

    // ── Disconnect ─────────────────────────────────────────

    /**
     * Handles client disconnection - cleans up room state
     * @event disconnect
     */
    socket.on('disconnect', () => {
      try {
        console.log(`[Signaling] Client disconnected: ${socket.id}`);
        const roomId = socketRoomMap.get(socket.id);
        if (roomId) {
          _handleLeaveRoom(socket, io, roomId);
        }
      } catch (error) {
        console.error('[Signaling] disconnect cleanup error:', error.message);
      }
    });
  });

  return io;
}

// ── Internal Helpers ─────────────────────────────────────────

/**
 * Adds a participant to a room and notifies others
 * @param {Socket} socket - The socket instance
 * @param {Object} room - The room object from the rooms Map
 * @param {string} roomId - The room identifier
 * @param {string} userId - The user's database ID
 * @param {string} userName - The user's display name
 */
function _addParticipantToRoom(socket, room, roomId, userId, userName) {
  // Join the Socket.io room
  socket.join(roomId);
  socketRoomMap.set(socket.id, roomId);

  // Add to participants map
  room.participants.set(socket.id, {
    userId,
    userName,
    isMuted: false,
    isCameraOff: false,
    isHandRaised: false,
    isScreenSharing: false,
    joinedAt: new Date().toISOString(),
  });

  // Build existing participants list for the new joiner
  const existingParticipants = [];
  room.participants.forEach((p, sid) => {
    if (sid !== socket.id) {
      existingParticipants.push({
        socketId: sid,
        userId: p.userId,
        userName: p.userName,
        isMuted: p.isMuted,
        isCameraOff: p.isCameraOff,
        isHandRaised: p.isHandRaised,
        isScreenSharing: p.isScreenSharing,
      });
    }
  });

  // Send room info to the new participant
  socket.emit('room-joined', {
    roomId,
    participants: existingParticipants,
    isRecording: room.isRecording,
    participantCount: room.participants.size,
  });

  // Notify existing participants about the new joiner
  socket.to(roomId).emit('user-joined', {
    socketId: socket.id,
    userId,
    userName,
    participantCount: room.participants.size,
  });

  console.log(`[Signaling] ${userName} joined room ${roomId} (${room.participants.size} participants)`);
}

/**
 * Handles a participant leaving a room
 * @param {Socket} socket - The socket instance
 * @param {Server} io - The Socket.io server instance
 * @param {string} roomId - The room identifier
 */
function _handleLeaveRoom(socket, io, roomId) {
  if (!roomId) return;

  const room = rooms.get(roomId);
  if (!room) return;

  const participant = room.participants.get(socket.id);
  const userName = participant ? participant.userName : 'Unknown';

  // Remove from room
  room.participants.delete(socket.id);
  room.waitingRoom.delete(socket.id);
  socketRoomMap.delete(socket.id);
  socket.leave(roomId);

  // If the host left, assign a new host or close the room
  if (room.host === socket.id) {
    if (room.participants.size > 0) {
      // Assign the first remaining participant as the new host
      const newHostId = room.participants.keys().next().value;
      room.host = newHostId;

      io.to(newHostId).emit('promoted-to-host', {
        message: 'You are now the meeting host.',
      });

      console.log(`[Signaling] New host assigned in room ${roomId}: ${newHostId}`);
    } else {
      // No participants left, clean up the room
      rooms.delete(roomId);
      console.log(`[Signaling] Room ${roomId} deleted (empty)`);
      return;
    }
  }

  // Notify remaining participants
  io.in(roomId).emit('user-left', {
    socketId: socket.id,
    userName,
    participantCount: room.participants.size,
  });

  console.log(`[Signaling] ${userName} left room ${roomId} (${room.participants.size} remaining)`);

  // Clean up empty rooms
  if (room.participants.size === 0) {
    rooms.delete(roomId);
    console.log(`[Signaling] Room ${roomId} deleted (empty)`);
  }
}

// ── Module Exports ───────────────────────────────────────────

module.exports = {
  startSignalingServer,
  rooms,
};
