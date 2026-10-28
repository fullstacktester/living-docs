import type { TestStep } from '@playwright/test/reporter';

type Attachment = TestStep['attachments'][number];

export interface FakeStep {
  title: string;
  category: string;
  start?: number;
  duration?: number;
  steps?: FakeStep[];
  attachments?: Attachment[];
  error?: { message: string };
}

/** A minimal TestStep for driving the builder without running Playwright. */
export function step(fake: FakeStep): TestStep {
  return {
    title: fake.title,
    category: fake.category,
    duration: fake.duration ?? 10,
    startTime: new Date(fake.start ?? 0),
    steps: (fake.steps ?? []).map(step),
    attachments: fake.attachments ?? [],
    error: fake.error,
    location: undefined,
    annotations: [],
    titlePath: () => [fake.title],
  } as unknown as TestStep;
}

export function jsonAttachment(name: string, body: unknown): Attachment {
  return {
    name,
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(body)),
  };
}
