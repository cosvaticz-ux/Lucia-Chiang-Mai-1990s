// Hit points with damage/death callbacks. Shared by Lucia and the infected.

export class HealthComponent {
  constructor(max) {
    this.max = max;
    this.hp = max;
    this.dead = false;
    this.onDamage = null; // (amount, info) => void
    this.onDeath = null; // (info) => void
    this.lastDamageTime = -999;
  }

  get ratio() {
    return this.hp / this.max;
  }

  damage(amount, info = {}) {
    if (this.dead || amount <= 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.lastDamageTime = info.time || 0;
    if (this.onDamage) this.onDamage(amount, info);
    if (this.hp <= 0) {
      this.dead = true;
      if (this.onDeath) this.onDeath(info);
      return true;
    }
    return false;
  }

  heal(amount) {
    if (this.dead) return 0;
    const before = this.hp;
    this.hp = Math.min(this.max, this.hp + amount);
    return this.hp - before;
  }

  reset() {
    this.hp = this.max;
    this.dead = false;
  }
}
