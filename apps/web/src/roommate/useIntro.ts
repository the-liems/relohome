import { useContext, useEffect, useRef, useState } from "react";
import { RoommateIdentity } from "./Features";
import { useResource } from "./useResource";
import { emptyProfile, type Profile } from "./types";

export const INTRO_CHANGED = "roommate-intro-changed";

export function useIntro(defaultName?: string) {
  const identity = useContext(RoommateIdentity);
  const name = defaultName || identity.name;
  const resource = useResource<Profile>("/me/intro"),
    dirty = useRef(false),
    initialized = useRef(false);
  const [value, setValue] = useState<Profile>(() => ({
    ...emptyProfile(),
    display_name: name || null,
  }));
  useEffect(() => {
    if (resource.loading || resource.error || dirty.current) return;
    // An existing empty intro can be the result of erasure; never repopulate it.
    if (resource.value) setValue(resource.value);
    else if (!initialized.current && name)
      setValue({ ...emptyProfile(), display_name: name });
    initialized.current = true;
  }, [resource.value, resource.loading, resource.error, name]);
  const reload = useRef(resource.reload);
  reload.current = resource.reload;
  useEffect(() => {
    const refresh = () => reload.current();
    window.addEventListener(INTRO_CHANGED, refresh);
    return () => window.removeEventListener(INTRO_CHANGED, refresh);
  }, []);
  return {
    ...resource,
    content: value,
    dirty,
    change: (next: Profile) => {
      dirty.current = true;
      setValue(next);
    },
    saved: () => {
      dirty.current = false;
      resource.reload();
      window.dispatchEvent(new Event(INTRO_CHANGED));
    },
  };
}
