/** The input's native required state is announced; the visual mark is decorative. */
export function RequiredMark({ required = true }: { required?: boolean }) {
  return required ? <span className="required-mark" aria-hidden="true" /> : null;
}
