/**
 * Shared header pickers for the observability pages: cluster selection
 * (reuses Forge's `useAllClusters`) and a generic "All / values" filter
 * select for model and status. Kept together so both pages share one idiom.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export {
  ClusterPicker,
  type ClusterPickerProps,
} from "@/components/k8s/ClusterPicker";

export interface FilterSelectProps {
  /** Current value; empty string means "all". */
  value: string;
  onChange: (next: string) => void;
  options: string[];
  allLabel: string;
  placeholder: string;
  width?: string;
  ariaLabel: string;
}

/** Sentinel for the "all" option — SelectItem cannot use an empty value. */
const ALL = "__all__";

export function FilterSelect({
  value,
  onChange,
  options,
  allLabel,
  placeholder,
  width = "w-[160px]",
  ariaLabel,
}: FilterSelectProps) {
  return (
    <Select
      value={value === "" ? ALL : value}
      onValueChange={(v) => onChange(v === ALL ? "" : v)}
    >
      <SelectTrigger className={`h-8 ${width} text-xs`} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL} className="text-xs">
          {allLabel}
        </SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt} value={opt} className="text-xs">
            {opt}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
