import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { OptionList } from './OptionList';

function Example() {
  const [value, setValue] = useState('a');
  return (
    <div className="w-150">
      <OptionList
        aria-label="예시"
        value={value}
        onValueChange={setValue}
        options={[
          { value: 'a', label: '첫 번째', description: '숫자 키 1로도 골라요' },
          { value: 'b', label: '두 번째', description: '숫자 키 2로도 골라요' },
          { value: 'c', label: '세 번째', description: '한 줄 설명' },
        ]}
      />
    </div>
  );
}

const meta = { title: 'Primitives/OptionList', component: Example } satisfies Meta<typeof Example>;

export default meta;
export const Default: StoryObj<typeof meta> = {};
