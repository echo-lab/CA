import React from "react";
import HomeIcon from "@mui/icons-material/Home";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

// Top bar of the reader: back to the book list, and the page pager.
export default function StoryBar({ page, pageCount, onHome, onPrev, onNext }) {
  return (
    <header className="storybar -tw-mx-3 tw-bg-[#f8f9fa] tw-border-b tw-border-solid tw-border-[#dee2e6] tw-px-4">
      <button
        type="button"
        className="storybar-btn storybar-home btn"
        aria-label="Back to the book list"
        onClick={onHome}
      >
        <HomeIcon />
      </button>

      <div className="storybar-pager">
        <button
          type="button"
          className="storybar-btn btn previous-page-button"
          aria-label="Previous page"
          onClick={onPrev}
          disabled={page === 0}
        >
          <ChevronLeftIcon />
        </button>

        <span className="storybar-page" aria-live="polite">
          Page {page + 1} of {pageCount}
        </span>

        <button
          type="button"
          className="storybar-btn btn next-page-button"
          aria-label="Next page"
          onClick={onNext}
          disabled={page >= pageCount - 1}
        >
          <ChevronRightIcon />
        </button>
      </div>
    </header>
  );
}
