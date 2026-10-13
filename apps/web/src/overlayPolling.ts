/** One optional overlay request at a time; failures wait for an explicit retry
 * (a new gate) or a new search scope instead of repeatedly hitting a broken API. */
export class OverlayPollGate {
  private inFlight = false;
  private paused = false;

  begin(): boolean {
    if (this.paused || this.inFlight) return false;
    this.inFlight = true;
    return true;
  }

  finish(failed = false): void {
    this.inFlight = false;
    if (failed) this.paused = true;
  }
}
