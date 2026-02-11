import React, { createContext, useContext, useRef, useState } from 'react';

const RealtimeContext = createContext();

export function RealtimeProvider({ children }) {
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [log, setLog] = useState([]);
  
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const dataChannelRef = useRef(null);

  const value = {
    connected,
    setConnected,
    muted,
    setMuted,
    log,
    setLog,
    pcRef,
    localStreamRef,
    remoteAudioRef,
    dataChannelRef,
  };

  return (
    <RealtimeContext.Provider value={value}>
      {children}
      {/* Global audio element for realtime API */}
      <audio ref={remoteAudioRef} autoPlay style={{ display: 'none' }} />
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtime must be used within a RealtimeProvider');
  }
  return context;
}
