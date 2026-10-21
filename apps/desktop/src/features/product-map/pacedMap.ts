import { useEffect, useMemo, useRef, useState } from 'react';

import type { TreeMap } from './flowTreeModel';

/** A new journey or step waits this long after the one before it; a long queue moves faster so it never lags far. */
const STEP_MS = 260;
const HURRIED_MS = 90;
const HURRY_AFTER = 12;

/** Every journey and step of the map, in the order the map reads: person by person, journey by journey, left to right. */
function keysOf(map: TreeMap) {
  const keys: string[] = [];
  for (const person of map.people)
    for (const journey of person.journeys) {
      keys.push(`j:${journey.id}`);
      for (const step of journey.steps) keys.push(`s:${journey.id}/${step}`);
    }
  return keys;
}

/**
 * While the AI draws, the map shows what it wrote one piece at a time, in reading order, rather than as it lands.
 * Agents write cards in bursts and out of order (several at once, a flow after its cards); the person sees journeys
 * and steps join the map one after another. What was there when drawing began shows at once, and when drawing ends
 * whatever still waits shows too.
 */
export function usePacedMap(map: TreeMap, paced: boolean): TreeMap {
  const [shown, setShown] = useState<Set<string>>(() => new Set(keysOf(map)));
  const [pacing, setPacing] = useState(paced);
  // Drawing starts: what is already on the map counts as shown.
  if (paced !== pacing) {
    setPacing(paced);
    if (paced) setShown(new Set(keysOf(map)));
  }
  const queue = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!paced) {
      queue.current = [];
      return;
    }
    const waiting = new Set(queue.current);
    for (const key of keysOf(map)) if (!shown.has(key) && !waiting.has(key)) queue.current.push(key);
    const next = () => {
      timer.current = null;
      const key = queue.current.shift();
      if (!key) return;
      setShown((current) => new Set(current).add(key));
      if (queue.current.length)
        timer.current = setTimeout(next, queue.current.length > HURRY_AFTER ? HURRIED_MS : STEP_MS);
    };
    if (!timer.current && queue.current.length) timer.current = setTimeout(next, STEP_MS);
  }, [map, paced, shown]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return useMemo(() => {
    if (!paced) return map;
    const people = map.people
      .map((person) => ({
        ...person,
        journeys: person.journeys
          .filter((journey) => shown.has(`j:${journey.id}`))
          .map((journey) => {
            const steps = journey.steps.filter((step) => shown.has(`s:${journey.id}/${step}`));
            const kept = new Set(steps);
            return {
              ...journey,
              steps,
              edges: journey.edges?.filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
            };
          }),
      }))
      .filter((person) => person.journeys.length);
    return { ...map, people };
  }, [map, paced, shown]);
}
