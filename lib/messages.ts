import type { DriftCorrectPayload, SyncCandidate, SyncCommandPayload, SyncEventPayload, SyncPositionResponse, SyncStatusResponse } from './sync-types';

export type HareMessage =
  | { type: 'GET_PAGE_CONTEXT' }
  | { type: 'GET_STATUS' }
  | { type: 'SET_SPEED'; payload: number }
  | { type: 'RESET_SPEED' }
  | { type: 'GET_STREAM' }
  | { type: 'FIND_MANIFEST'; payload: { tabId: number; manifests: string[] } }
  | { type: 'SYNC_ACTIVATE' }
  | { type: 'SYNC_DEACTIVATE' }
  | { type: 'SYNC_EVENT'; payload: SyncEventPayload }
  | { type: 'SYNC_PAUSE' | 'SYNC_PLAY' | 'SYNC_SEEK' | 'SYNC_RATE'; payload: SyncCommandPayload }
  | { type: 'SYNC_DRIFT_CORRECT'; payload: DriftCorrectPayload }
  | { type: 'SYNC_GET_POSITION' }
  | { type: 'GET_SYNC_CANDIDATES' }
  | { type: 'GET_MPV_CANDIDATE' }
  | { type: 'START_SYNC'; payload: { tabIdA: number; tabIdB: number } }
  | { type: 'STOP_SYNC' }
  | { type: 'NUDGE_OFFSET'; payload: number }
  | { type: 'SET_NUDGE_STEP'; payload: number }
  | { type: 'GET_SYNC_STATUS' };

export type Ack = { success: boolean; error?: string };

/** Reply for each message type. Any handler may also reply `{ success: false, error }` if it throws. */
export interface Replies {
  GET_PAGE_CONTEXT: { hostname: string };
  GET_STATUS: { speeds: number[] };
  SET_SPEED: Ack;
  RESET_SPEED: Ack;
  FIND_MANIFEST: { url: string | null };
  GET_STREAM: { src: string | null; page: string; encrypted: boolean; time: number; manifests: string[] } | null;
  SYNC_ACTIVATE: (SyncPositionResponse & { success: true }) | { success: false; error: string };
  SYNC_DEACTIVATE: Ack;
  SYNC_EVENT: Ack;
  SYNC_PAUSE: Ack;
  SYNC_PLAY: Ack;
  SYNC_SEEK: Ack;
  SYNC_RATE: Ack;
  SYNC_DRIFT_CORRECT: Ack;
  SYNC_GET_POSITION: SyncPositionResponse | null;
  GET_SYNC_CANDIDATES: SyncCandidate[];
  GET_MPV_CANDIDATE: SyncCandidate | null;
  START_SYNC: Ack;
  STOP_SYNC: Ack;
  NUDGE_OFFSET: Ack;
  SET_NUDGE_STEP: Ack;
  GET_SYNC_STATUS: SyncStatusResponse;
}

export type Reply<M extends HareMessage> = Replies[M['type']];

