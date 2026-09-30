import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from './Button';
import { Dialog } from './Dialog';
import { Input } from './Input';

function Example() {
  return (
    <Dialog.Root defaultOpen>
      <Dialog.Trigger render={<Button />}>열기</Dialog.Trigger>
      <Dialog.Popup>
        <Dialog.Title>제목</Dialog.Title>
        <Dialog.Description>시트 가운데, 가림막 위에 떠요. 열려 있는 동안 포커스는 안에 머물러요.</Dialog.Description>
        <Input placeholder="입력" />
        <div className="flex justify-end gap-2">
          <Dialog.Close render={<Button />}>닫기</Dialog.Close>
          <Button variant="primary">확정</Button>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

const meta = { title: 'Primitives/Dialog', component: Example, parameters: { layout: 'fullscreen' } } satisfies Meta<
  typeof Example
>;

export default meta;
export const Open: StoryObj<typeof meta> = {};
