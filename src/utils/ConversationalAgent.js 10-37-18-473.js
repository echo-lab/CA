const BASE_URL = process.env.REACT_APP_API_BASE;

import { createContext, useContext, useRef, useState, useEffect } from 'react';

const ConversationalAgent = createContext(null);

export async function RealTimeConnect( { pcRef, localStreamRef, remoteAudioRef, dataChannelRef } ) {
    try {
      console.log("Starting connection…");
      const tokenResp = await fetch(`${BASE_URL}/api/rt-connection` );
      console.log("Response status:", tokenResp.status);
      console.log("Response headers:", tokenResp.headers.get("content-type"));
      
      if (!tokenResp.ok) {
        const errorText = await tokenResp.text();
        console.error(`Failed to get token (${tokenResp.status}):`, errorText.substring(0, 500));
        throw new Error(`Server error: ${tokenResp.status}`);
      }
      
      const contentType = tokenResp.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const responseText = await tokenResp.text();
        console.error("Expected JSON but got:", contentType);
        console.error("Response body:", responseText.substring(0, 500));
        throw new Error(`Server returned ${contentType} instead of JSON. Check if the server is running on the correct port.`);
      }

      console.log("Fetched token from server");
      let tokenJson = await tokenResp.json();
      console.log("Token JSON:", tokenJson);
      const clientSecret = tokenJson?.value;
      
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.ontrack = (e) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = e.streams[0];
          remoteAudioRef.current.play()
            .then(() => console.log("✅ Audio playback started"))
            .catch((err) => console.error("❌ Audio playback failed:", err));
        } else {
          console.error("❌ remoteAudioRef.current is null - audio element not found");
        }
      };

      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;
      dc.onopen = () => console.log("DataChannel opened");
      dc.onmessage = () => {};

      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = ms;
      ms.getAudioTracks().forEach((t) => pc.addTrack(t, ms));

      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      const sdpResp = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          "Content-Type": "application/sdp",
        },
      });

      const answer = { type: "answer", sdp: await sdpResp.text() };
      await pc.setRemoteDescription(answer);

      const initialContext = "You are helping toddlers learn about patterns." // await fetchRAGContext("overview main topics summary");

      setTimeout(() => {
        const systemInstruction = {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: `You are a helpful assistant. You have access to the following document context:\n\n${initialContext || "No context loaded yet"}\n\nWhen answering user questions:\n1. Always base your answers on the provided context above and any additional context sent with questions\n2. If the context doesn't contain relevant information, say so clearly\n3. Keep your answers concise (1-2 sentences)\n4. Once you have answered the question, be quiet and wait for the next question`,
              },
            ],
          },
        };
        dataChannelRef.current?.send(JSON.stringify(systemInstruction));
      }, 500);
    } catch (err) {
      console.error("Error: " + (err?.message || err));
      console.error(err);
    }
}

export async function say({
  text,
  voiceName,
  emotion = "neutral",
}) {
  if (!BASE_URL) {
    throw new Error("REACT_APP_TTSURL not defined in .env.local");
  }
  if (!text || !text.trim()) throw new Error("Missing text");

  const res = await fetch(`${BASE_URL}/live/say`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voiceName, emotion }),
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      if (err?.message) msg += `: ${err.message}`;
    } catch {}
    throw new Error(msg);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);

  // Cleanup URL after playback
  audio.addEventListener("ended", () => URL.revokeObjectURL(url));
  audio.addEventListener("error", () => URL.revokeObjectURL(url));

  await audio.play();
  return { audio, url };
}

export const useRealtimeAPI = () => {
  const context = useContext(ConversationalAgent);
  if (!context) {
    throw new Error('useRealtimeAPI must be used within RealtimeAPIProvider');
  }
  return context;
};