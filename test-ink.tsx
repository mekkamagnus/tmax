import { render, Box, Text } from "jsr:@deno-ink/core";

const App = () => {
  return (
    <Box>
      <Text>Hello from deno-ink!</Text>
    </Box>
  );
};

render(<App />);
