// The settle reveal — demo centerpiece. Three beats:
//   1. "Winner + pot" (envelopes flip; the loser's number is never published)
//   2. "Find the losing number" — the comparison appears with the loser masked
//   3. "Athletes chose to disclose" — full comparison, honest framing: the
//      ledger never revealed it; the athletes did.

import { useState } from 'react';
import type { WagerSettleResult } from '../domain/types';
import { fmtKm, fmtTnight } from '../lib/format';
import { Button, Notice } from './bits';

export const RevealSettle = ({ result }: { result: WagerSettleResult }) => {
  const { wager } = result;
  const [phase, setPhase] = useState<'reveal' | 'room' | 'disclosed'>('reveal');
  const res = wager.result;
  if (!res) return null;

  const challengerValue = res.challengerValue ?? 0;
  const opponentValue = res.opponentValue ?? 0;
  const winnerIsChallenger = res.winner?.role === 'local';
  const winnerValue = winnerIsChallenger ? challengerValue : opponentValue;

  return (
    <div className="reveal-card">
      <div className="row-between">
        <div>
          <div className="card-title" style={{ margin: 0 }}>
            Settlement — {wager.title}
          </div>
          <div className="hero" style={{ marginTop: 8 }}>
            {res.tie ? 'Dead heat — stakes returned to both athletes.' : res.forfeit ? res.summary : `Winner: ${res.winner?.name} — ${fmtTnight(res.pot)} ${res.currency} pot moves.`}
          </div>
        </div>
        <Chip />
      </div>

      <div className="reveal-grid">
        <div className="reveal-side">
          <div className="reveal-side__name">{wager.challenger.name}</div>
          {phase === 'disclosed' ? (
            <div className={`reveal-side__value ${winnerIsChallenger ? '' : 'reveal-side__value--loser'}`}>
              {fmtKm(challengerValue)}
            </div>
          ) : phase === 'room' ? (
            <div className="reveal-side__value">{winnerIsChallenger ? fmtKm(winnerValue) : <Masked />}</div>
          ) : (
            <div className="reveal-masked">••••</div>
          )}
        </div>
        <div className="reveal-vs">VS</div>
        <div className="reveal-side">
          <div className="reveal-side__name">{wager.opponent.name}</div>
          {phase === 'disclosed' ? (
            <div className={`reveal-side__value ${winnerIsChallenger ? 'reveal-side__value--loser' : ''}`}>
              {fmtKm(opponentValue)}
            </div>
          ) : phase === 'room' ? (
            <div className="reveal-side__value">{winnerIsChallenger ? <Masked /> : fmtKm(winnerValue)}</div>
          ) : (
            <div className="reveal-masked">••••</div>
          )}
        </div>
      </div>

      {res.nft ? (
        <div
          className="reveal-card"
          style={{
            marginTop: 14,
            borderColor: 'rgba(217, 164, 65, 0.45)',
            background: 'linear-gradient(180deg, rgba(217, 164, 65, 0.07), rgba(217, 164, 65, 0.02))',
            boxShadow: '0 0 34px rgba(217, 164, 65, 0.1)',
          }}
        >
          <div className="row" style={{ gap: 14 }}>
            <div className="medal" style={{ width: 40, height: 40, fontSize: 17 }}>🏅</div>
            <div>
              <div style={{ fontWeight: 700 }}>Winner receives the WitnessFitness NFT</div>
              <div className="muted" style={{ fontSize: 13 }}>
                A shielded coin — the winner can prove they own it without revealing anything about the wager.
              </div>
              <div className="row" style={{ marginTop: 8, gap: 14, flexWrap: 'wrap' }}>
                <span className="chip chip--gold">token {res.nft.tokenType.slice(0, 18)}…</span>
                <span className="hash">minted in tx {res.nft.txHash.slice(0, 20)}…</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {phase === 'reveal' && (
        <Notice tone="info">
          The chain compared two sealed distances and paid the winner — the room has seen{' '}
          <strong>zero numbers</strong>. The losing value was never published to the ledger.
        </Notice>
      )}
      {phase === 'room' && (
        <Notice tone="warn">
          <strong>Challenge the room:</strong> the winner ran {fmtKm(winnerValue)}. The losing
          number is somewhere between — nobody can guess it, because nobody saw it.
        </Notice>
      )}
      {phase === 'disclosed' && (
        <Notice tone="success">
          The athletes <strong>chose to disclose</strong> the comparison after settlement. The
          ledger never revealed the losing input — this reveal is a social choice, not a chain
          event. {fmtTnight(res.pot)} already moved under seal.
        </Notice>
      )}

      <div className="row" style={{ marginTop: 16, justifyContent: 'center' }}>
        {res.nft ? (
        <div
          className="reveal-card"
          style={{
            marginTop: 14,
            borderColor: 'rgba(217, 164, 65, 0.45)',
            background: 'linear-gradient(180deg, rgba(217, 164, 65, 0.07), rgba(217, 164, 65, 0.02))',
            boxShadow: '0 0 34px rgba(217, 164, 65, 0.1)',
          }}
        >
          <div className="row" style={{ gap: 14 }}>
            <div className="medal" style={{ width: 40, height: 40, fontSize: 17 }}>🏅</div>
            <div>
              <div style={{ fontWeight: 700 }}>Winner receives the WitnessFitness NFT</div>
              <div className="muted" style={{ fontSize: 13 }}>
                A shielded coin — the winner can prove they own it without revealing anything about the wager.
              </div>
              <div className="row" style={{ marginTop: 8, gap: 14, flexWrap: 'wrap' }}>
                <span className="chip chip--gold">token {res.nft.tokenType.slice(0, 18)}…</span>
                <span className="hash">minted in tx {res.nft.txHash.slice(0, 20)}…</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {phase === 'reveal' && (
          <Button tone="primary" onClick={() => setPhase('room')}>
            Show the room — winner only
          </Button>
        )}
        {phase === 'room' && (
          <Button tone="seal" onClick={() => setPhase('disclosed')}>
            Athletes choose to disclose
          </Button>
        )}
      </div>
    </div>
  );
};

const Masked = () => <span className="reveal-masked" title="never published to the ledger">▮▮▮▮</span>;

const Chip = () => (
  <span className="chip chip--provable">settled under seal</span>
);
