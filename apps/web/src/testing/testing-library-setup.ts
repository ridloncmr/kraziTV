import { configure } from "@testing-library/react";

// The 1s default flakes when the whole workspace tests in parallel: one
// program's first render waits on several fetches. A real hang still fails.
configure({ asyncUtilTimeout: 3_000 });
