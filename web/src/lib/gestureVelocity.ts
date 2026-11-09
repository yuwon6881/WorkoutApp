/** Release speed over recent time, independent of pointer-event/display refresh frequency. */
export class GestureVelocity {
  private samples: { position: number; at: number }[] = [];
  add(position: number, at: number) {
    this.samples = this.samples.filter(sample => sample.at >= at - 60 && sample.at < at);
    this.samples.push({ position, at });
  }
  at(now: number): number {
    const first = this.samples[0];
    const last = this.samples.at(-1);
    if (!first || !last || last.at <= first.at || now - last.at > 60) return 0;
    return (last.position - first.position) / (last.at - first.at);
  }
}
