import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PICKABLE_DAYS, sendDayOptionLabel } from "@/lib/recurringSchedule";

interface Props {
  id?: string;
  value: number;
  onChange: (day: number) => void;
  disabled?: boolean;
}

export default function SendDaySelect({ id, value, onChange, disabled }: Props) {
  return (
    <Select
      value={String(value)}
      onValueChange={(v) => onChange(parseInt(v, 10))}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {PICKABLE_DAYS.map((day) => (
          <SelectItem key={day} value={String(day)}>
            {sendDayOptionLabel(day)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
