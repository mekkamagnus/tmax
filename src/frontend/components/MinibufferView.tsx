import { Box, Text } from "ink";
import type { MinibufferRenderSegment, MinibufferRenderView } from "../../core/types.ts";

interface MinibufferViewProps {
  view: MinibufferRenderView;
}

const Segment = ({ segment, selected }: {
  segment: MinibufferRenderSegment;
  selected: boolean;
}) => (
  <Text
    backgroundColor={selected ? "blue" : undefined}
    bold={segment.face === "completion-match" || segment.face === "selected"}
    underline={segment.face === "completion-match"}
    dimColor={segment.face === "annotation"}
  >
    {segment.text}
  </Text>
);

/**
 * Render the generic view model published by T-Lisp.
 */
export const MinibufferView = ({ view }: MinibufferViewProps) => (
  <Box flexDirection="column">
    {view.rows.map((row, rowIndex) => (
      <Box key={rowIndex}>
        {row.segments.map((segment, segmentIndex) => (
          <Segment key={segmentIndex} segment={segment} selected={row.selected} />
        ))}
      </Box>
    ))}
    <Box>
      <Text>{view.prompt}{view.input}</Text>
      <Text>{view.message ? ` ${view.message}` : ""}</Text>
    </Box>
  </Box>
);
