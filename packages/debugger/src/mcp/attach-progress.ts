/**
 * `start_attach` progress 알림.
 *
 * 클라이언트가 요청에 `_meta.progressToken`을 실어 보낸 경우에만 동작한다. attach 단계
 * 기록기(`AttachTimeline`)를 구독해 단계가 바뀔 때마다, 그리고 단계 변화가 없어도 15초마다
 * 한 번 `notifications/progress`를 보낸다. 대기가 3분까지 길어지는 동안 "지금 어디까지
 * 왔는지"를 보여 주기 위한 것이고, 같은 정보는 타임아웃 에러·`get_debug_status`에도 들어
 * 있어서 progress를 못 보는 클라이언트도 잃는 게 없다.
 *
 * SECRET-HANDLING: 메시지는 `formatStageLabel`(고정 라벨)과 경과 초만 담는다. relay URL·
 * TOTP 코드·페이지 URL은 들어갈 수 없다.
 */
import { type AttachStageEvent, type AttachTimeline, formatStageLabel } from './attach-timeline.js';

export const ATTACH_PROGRESS_HEARTBEAT_MS = 15_000;

export interface AttachProgressNotification {
  method: 'notifications/progress';
  params: {
    progressToken: string | number;
    progress: number;
    total?: number;
    message: string;
  };
}

export interface StartAttachProgressOptions {
  timeline: AttachTimeline;
  /** 요청의 `_meta.progressToken`. 없으면 아무것도 하지 않는다. */
  progressToken: string | number | undefined;
  sendNotification: (notification: AttachProgressNotification) => Promise<void>;
  /** 취소·대체되면 알림을 멈춘다. */
  signal?: AbortSignal;
  /** 전체 대기 한도(초). heartbeat 메시지의 분모. */
  totalSec: number;
  nowMs?: () => number;
  heartbeatMs?: number;
}

/** 대기 중 phone 쪽 상태를 한 줄로. 아직 폰 신호가 없으면 그 사실을 그대로 쓴다. */
function describeStatus(events: AttachStageEvent[]): string {
  const phoneEvents = events.filter(
    (e) =>
      e.stage === 'device-handshake' ||
      e.stage === 'auth' ||
      e.stage === 'target-connected' ||
      e.stage === 'target-disconnected',
  );
  const last = phoneEvents[phoneEvents.length - 1];
  return last ? formatStageLabel(last) : '폰 응답 없음';
}

export function startAttachProgress(opts: StartAttachProgressOptions): { stop(): void } {
  const { timeline, progressToken, sendNotification, signal, totalSec } = opts;
  if (progressToken === undefined || progressToken === null) return { stop() {} };
  const nowMs = opts.nowMs ?? (() => Date.now());
  const heartbeatMs = opts.heartbeatMs ?? ATTACH_PROGRESS_HEARTBEAT_MS;

  let stopped = false;
  let counter = 0;

  const send = (message: string): void => {
    if (stopped || signal?.aborted) return;
    counter += 1;
    try {
      sendNotification({
        method: 'notifications/progress',
        params: { progressToken, progress: counter, message },
      }).catch(() => {});
    } catch {
      // 알림 실패는 attach를 깨뜨리지 않는다.
    }
  };

  const unsubscribe = timeline.onStage((event) => {
    send(formatStageLabel(event));
  });

  const timer = setInterval(() => {
    const snap = timeline.snapshot();
    const startedMs = snap.attemptStartedAt ? Date.parse(snap.attemptStartedAt) : nowMs();
    const elapsed = Math.max(0, Math.round((nowMs() - startedMs) / 1000));
    send(`QR 스캔 대기 중 ${elapsed}/${totalSec}초 — ${describeStatus(snap.events)}`);
  }, heartbeatMs);
  timer.unref?.();

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    unsubscribe();
  };
  signal?.addEventListener('abort', stop, { once: true });
  return { stop };
}
