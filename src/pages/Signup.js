import React, { useEffect, useState } from 'react';
import '../styles/signup.css';
import image2 from '../Pictures/Mate05/Mates-05.png'
import SentimentVerySatisfiedIcon from '@mui/icons-material/SentimentVerySatisfied';
import { useNavigate } from 'react-router-dom';
import {
  getParticipant,
  getPidFromUrl,
  setParticipant,
  verifyParticipant,
} from '../utils/participant';

function Signup() {
  // participantId is the study identifier (verified against the server roster);
  // childName is display-only and never leaves the browser.
  const [participantId, setParticipantId] = useState('');
  const [childName, setChildName] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const navigate = useNavigate();

  // userName is display-only — it is spoken aloud to the child on the character
  // screen ("Hello {userName}, I am Child"), so it must never fall back to the
  // participant ID. The roster's `child` field covers ?pid= links where the form
  // was skipped; failing that it stays empty, as it did before IDs existed.
  const proceed = (record, name) => {
    setParticipant(record);
    navigate('/ChildSelect', {
      state: {
        userName: name || record.child || '',
        participantId: record.user_id,
      },
    });
  };

  // A ?pid=<id> link, or an ID already verified earlier this session, skips the
  // form entirely.
  useEffect(() => {
    const existing = getParticipant();
    const pid = getPidFromUrl() || existing?.user_id;
    if (!pid) return;

    let cancelled = false;
    setVerifying(true);
    verifyParticipant(pid)
      .then((record) => {
        if (!cancelled) proceed(record, '');
      })
      .catch((err) => {
        if (!cancelled) {
          setParticipantId(pid);
          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setVerifying(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setVerifying(true);
    try {
      const record = await verifyParticipant(participantId);
      proceed(record, childName.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="signup">
      <div className="signupcard">
        <div className='row row-signup'>
          <div className="col-md-6 left-column">
            <img src={image2} className="card-img" alt="" />
          </div>
          <div className="col-md-6 right-column">
            <div className="welcome-header">
              <span className="icon"><SentimentVerySatisfiedIcon fontSize="large"/></span>
              <h3 className="welcome-text">Welcome!</h3>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="participantId">Participant ID:</label>
                <input
                  type="text"
                  className="form-control"
                  id="participantId"
                  placeholder="Provided by the researcher"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck="false"
                  value={participantId}
                  onChange={(e) => { setParticipantId(e.target.value); setError(''); }}
                />
              </div>
              <div className="form-group">
                <label htmlFor="name">Child's name (optional):</label>
                <input
                  type="text"
                  className="form-control"
                  id="name"
                  placeholder="Shown in the app only"
                  value={childName}
                  onChange={(e) => setChildName(e.target.value)}
                />
              </div>
              {error && (
                <p style={{ color: '#c62828', margin: '8px 0 0' }} role="alert">{error}</p>
              )}
              <button type="submit" className="button" disabled={verifying || !participantId.trim()}>
                {verifying ? 'Checking…' : 'Start'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Signup;
