const BASE_URL = process.env.REACT_APP_API_BASE;

/**
 * Initializes a WebRTC connection to OpenAI's Realtime API
 * @param {Object} refs - Object containing React refs { pcRef, localStreamRef, remoteAudioRef, dataChannelRef }
 * @param {Function} setConnected - State setter function for connection status
 * @returns {Promise<void>}
 */
export async function CallRealTimeAPI(refs, setConnected) {
  const { pcRef, localStreamRef, remoteAudioRef, dataChannelRef } = refs;
  
  try {
    const tokenResp = await fetch("/api/rt-connection");
    let tokenJson = await tokenResp.json();
    const clientSecret = tokenJson?.value;
    if (!clientSecret) throw new Error("No client secret returned");

    const pc = new RTCPeerConnection();
    pcRef.current = pc;

      pc.ontrack = (e) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = e.streams[0];
          remoteAudioRef.current.play().catch(() => {});
        }
      };

      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;
      dc.onopen = () => console.log("Data channel opened");
      dc.onmessage = (evt) => console.log("Data channel message:", evt.data);

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

      setConnected(true);

      setTimeout(() => {
        const systemInstruction = {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: `You are a helpful assistant. When answering user questions:\n1. Always base your answers on the provided context above and any additional context sent with questions\n2. If the context doesn't contain relevant information, say so clearly\n3. Keep your answers concise (1-2 sentences)\n4. Once you have answered the question, be quiet and wait for the next question`,
              },
            ],
          },
        };
      dataChannelRef.current?.send(JSON.stringify(systemInstruction));
    }, 500);
  } catch (err) {
    console.error("Error starting realtime connection: " + (err?.message || err));
    throw err; // Re-throw so caller can handle
  }
}