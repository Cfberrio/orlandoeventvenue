/**
 * /book progress labels (UI2-15): a guest can go back to a step already
 * completed, never forward past the step they are on. Forward moves only
 * happen through each step's own validated "Continue" button.
 */
export function canJumpToStep(target: number, current: number): boolean {
  return Number.isInteger(target) && target >= 1 && target < current;
}
