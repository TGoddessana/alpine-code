import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { fn } from 'storybook/test';

import { DataTab } from '@/features/data/DataTab';
import { ARRIVING, BOOKING_TABLES, useEditableTables } from '@/features/data/preview';
import { Dock } from '@/features/dock/Dock';
import { showDockTab } from '@/features/dock/state';
import { PublishButton } from '@/features/publish/PublishButton';
import { PublishOffer } from '@/features/publish/PublishOffer';

const PROJECT = { name: 'craft-booking', changes: 3, lastPublished: new Date(Date.now() - 7_200_000) };

/**
 * The pieces of docs/alpine-cloud.md together, the way the session screen would hold them: the top bar's 올리기, the
 * AI's offer in the conversation, and the dock's 데이터 tab where a friend's booking arrives (the aha). Stand-in
 * data throughout.
 */
function Workspace() {
  useEffect(() => showDockTab('data'), []);
  const [tables, writes] = useEditableTables(BOOKING_TABLES, ARRIVING, 3000);
  const [offer, setOffer] = useState(true);
  return (
    <div className="flex h-screen flex-col bg-canvas-sunken">
      <div className="flex h-11.5 shrink-0 items-center gap-2 pr-3 pl-20">
        <span className="text-body text-fg">craft-booking</span>
        <span className="text-meta text-fg-muted">대기 명단 만들기</span>
        <span className="grow" />
        <PublishButton project={PROJECT} />
      </div>
      <div className="mx-2 mb-2 flex min-h-0 grow overflow-hidden rounded-xl border border-line bg-canvas">
        <main className="flex min-w-0 grow justify-center overflow-y-auto">
          <div className="flex w-full max-w-175 flex-col gap-5 px-6 py-10">
            <div className="self-end rounded-2xl bg-hover px-4 py-2.5 text-reading">
              자리가 차면 대기 명단에 올려 주는 것까지 해 줘
            </div>
            <p className="text-reading text-fg">
              대기 명단 표를 만들고, 수업 정원이 차면 예약 버튼이 &ldquo;대기 명단에 올리기&rdquo;로 바뀌게 했어요.
              자리가 나면 맨 앞 사람에게 메일이 가요.
            </p>
            <p className="text-meta text-fg-muted">명령 3개 실행 · 파일 4개 바꿈 · 화면 2번 봄 ›</p>
            {offer && <PublishOffer evidence={2} onPublish={() => setOffer(false)} onLater={() => setOffer(false)} />}
          </div>
        </main>
        <Dock
          scope="cloud-story"
          tabs={[
            { id: 'changes', label: '변경 사항', content: <p className="text-meta text-fg-muted">바뀐 파일 4개</p> },
            { id: 'web', label: '웹', content: <p className="text-meta text-fg-muted">미리보기</p> },
            {
              id: 'data',
              label: '데이터',
              bare: true,
              content: (
                <DataTab
                  tables={tables}
                  writes={writes}
                  aiReads={2}
                  restorePoints={3}
                  onAiReads={fn()}
                  onRestorePoints={fn()}
                />
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}

const meta = {
  title: 'Alpine Cloud/Workspace',
  component: Workspace,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Workspace>;

export default meta;

export const FriendBooks: StoryObj<typeof meta> = {};
