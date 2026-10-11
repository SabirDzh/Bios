import { useId } from 'react';
import './SegmentedControl.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  /** Подпись группы (role legend), как label у TextField. */
  legend: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  name?: string;
}

/**
 * Переключатель из двух-трёх равнозначных вариантов: нативные radio в общей
 * рамке — стрелки клавиатуры, объявление «N из M» и фокус работают без JS.
 */
export function SegmentedControl<T extends string>({
  legend,
  value,
  options,
  onChange,
  name,
}: SegmentedControlProps<T>) {
  const autoName = useId();
  const groupName = name ?? autoName;

  return (
    <fieldset className="segmented-field">
      <legend className="field-label">{legend}</legend>
      <div className="segmented">
        {options.map((option) => (
          <label
            key={option.value}
            className="segmented-option"
            data-checked={value === option.value}
          >
            <input
              type="radio"
              className="segmented-input"
              name={groupName}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
