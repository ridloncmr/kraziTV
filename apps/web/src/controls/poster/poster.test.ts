// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Poster } from "./poster.js";

afterEach(cleanup);

it("hides itself once its image fails to load, and tries a new poster again", () => {
  const view = render(
    createElement(Poster, {
      src: "https://image.tmdb.org/t/p/w342/alien.jpg",
      alt: "Poster for Alien",
      className: "media-poster",
    }),
  );
  const poster = screen.getByRole("img", { name: "Poster for Alien" });
  expect(poster.className).toBe("media-poster");

  fireEvent.error(poster);
  expect(screen.queryByRole("img")).toBeNull();

  view.rerender(
    createElement(Poster, {
      src: "https://image.tmdb.org/t/p/w342/aliens.jpg",
      alt: "Poster for Aliens",
    }),
  );
  expect(screen.getByRole("img", { name: "Poster for Aliens" })).toBeTruthy();
});
