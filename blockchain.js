/**
 * blockchain.js
 * College Voting System — SHA-256 Blockchain Engine
 * Uses Web Crypto API for real cryptographic hashing
 */

// ─── SHA-256 via Web Crypto ───────────────────────────────────────────────────
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(String(message));
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Block ────────────────────────────────────────────────────────────────────
class Block {
  constructor(index, timestamp, data, previousHash = '') {
    this.index = index;
    this.timestamp = timestamp;
    this.data = data;           // { type, voterHash, candidateId, electionId }
    this.previousHash = previousHash;
    this.nonce = 0;
    this.hash = '';
  }

  async calculateHash() {
    const content = `${this.index}${this.timestamp}${JSON.stringify(this.data)}${this.previousHash}${this.nonce}`;
    return await sha256(content);
  }

  async mineBlock(difficulty) {
    const target = '0'.repeat(difficulty);
    this.hash = await this.calculateHash();
    while (!this.hash.startsWith(target)) {
      this.nonce++;
      this.hash = await this.calculateHash();
    }
    return this.hash;
  }

  toJSON() {
    return {
      index: this.index,
      timestamp: this.timestamp,
      data: this.data,
      previousHash: this.previousHash,
      nonce: this.nonce,
      hash: this.hash,
    };
  }
}

// ─── Blockchain ───────────────────────────────────────────────────────────────
class Blockchain {
  constructor(difficulty = 2) {
    this.chain = [];
    this.difficulty = difficulty;
    this._initialized = false;
  }

  async init() {
    const saved = localStorage.getItem('cvs_chain');
    if (saved) {
      try {
        this.chain = JSON.parse(saved);
        this._initialized = true;
        return;
      } catch (_) { /* fall through to create genesis */ }
    }
    await this._createGenesisBlock();
    this._initialized = true;
  }

  async _createGenesisBlock() {
    const genesisData = {
      type: 'GENESIS',
      message: 'College Voting System — Genesis Block',
      createdAt: new Date().toISOString(),
    };
    const block = new Block(0, new Date().toISOString(), genesisData, '0000000000000000');
    block.hash = await sha256(`GENESIS${block.timestamp}${JSON.stringify(genesisData)}`);
    this.chain = [block.toJSON()];
    this._save();
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  // ── Cast a vote ────────────────────────────────────────────────────────────
  async castVote(voterHash, candidateId, electionId, studentId) {
    if (!this._initialized) await this.init();

    if (this.hasVoted(voterHash, electionId)) {
      throw new Error('ALREADY_VOTED');
    }

    const block = new Block(
      this.chain.length,
      new Date().toISOString(),
      { type: 'VOTE', voterHash, candidateId, electionId, studentId },
      this.getLatestBlock().hash
    );

    // Show mining progress via event
    window.dispatchEvent(new CustomEvent('block:mining', { detail: { index: block.index } }));
    await block.mineBlock(this.difficulty);
    window.dispatchEvent(new CustomEvent('block:mined', { detail: block.toJSON() }));

    this.chain.push(block.toJSON());
    this._save();
    return block.toJSON();
  }

  // ── Check if voter already voted in this election ─────────────────────────
  hasVoted(voterHash, electionId) {
    return this.chain.some(
      b => b.data.type === 'VOTE' &&
           b.data.voterHash === voterHash &&
           b.data.electionId === electionId
    );
  }

  // ── Tally results for an election ─────────────────────────────────────────
  getResults(electionId) {
    const votes = this.chain.filter(
      b => b.data.type === 'VOTE' && b.data.electionId === electionId
    );
    const tally = {};
    votes.forEach(b => {
      tally[b.data.candidateId] = (tally[b.data.candidateId] || 0) + 1;
    });
    return tally;
  }

  getTotalVotes(electionId) {
    return this.chain.filter(
      b => b.data.type === 'VOTE' && b.data.electionId === electionId
    ).length;
  }

  getVoteBlocks(electionId) {
    return this.chain.filter(
      b => b.data.type === 'VOTE' && b.data.electionId === electionId
    );
  }

  // ── Validate entire chain ─────────────────────────────────────────────────
  async isChainValid() {
    for (let i = 1; i < this.chain.length; i++) {
      const curr = this.chain[i];
      const prev = this.chain[i - 1];

      // Recalculate hash
      const recalculated = await sha256(
        `${curr.index}${curr.timestamp}${JSON.stringify(curr.data)}${curr.previousHash}${curr.nonce}`
      );

      if (curr.hash !== recalculated) return { valid: false, failedAt: i, reason: 'Hash mismatch' };
      if (curr.previousHash !== prev.hash) return { valid: false, failedAt: i, reason: 'Chain broken' };
    }
    return { valid: true };
  }

  // ── Persistence ───────────────────────────────────────────────────────────
  _save() {
    localStorage.setItem('cvs_chain', JSON.stringify(this.chain));
  }

  reset() {
    localStorage.removeItem('cvs_chain');
    this.chain = [];
    this._initialized = false;
  }

  get length() { return this.chain.length; }
}

// ─── Export as global singleton ───────────────────────────────────────────────
window.sha256 = sha256;
window.Block = Block;
window.VoteChain = new Blockchain(2);
