library(ggplot2)
library(dplyr)
library(lubridate)

args <- commandArgs(trailingOnly = TRUE)
csv_path <- if (length(args) >= 1) args[1] else "scripts/sentiment-data.csv"
out_path <- if (length(args) >= 2) args[2] else "docs/screenshots/sentiment-trend.png"

df <- read.csv(csv_path, stringsAsFactors = FALSE) %>%
  mutate(
    date = as.POSIXct(start_iso, format = "%Y-%m-%dT%H:%M:%OS", tz = "UTC"),
    week_date = floor_date(date, "week"),
    sentiment_inv = -sentiment_raw + max(sentiment_raw, na.rm = TRUE)
  ) %>%
  filter(!is.na(date))

weekly <- df %>%
  group_by(week_date) %>%
  summarise(
    avg_sentiment = mean(sentiment_raw, na.rm = TRUE),
    n = n(),
    se = sd(sentiment_raw, na.rm = TRUE) / sqrt(n()),
    .groups = "drop"
  ) %>%
  filter(n >= 2) %>%
  mutate(
    lower = avg_sentiment - 1.96 * se,
    upper = avg_sentiment + 1.96 * se
  )

milestones <- tribble(
  ~date,                    ~label,                    ~y_offset,
  "2026-03-24",             "Per-model baselines",      1.5,
  "2026-04-10",             "Stella hooks shipped",     1.8,
  "2026-04-17",             "Quality gate overhaul",    1.3,
)
milestones$date <- as.POSIXct(milestones$date, tz = "UTC")

top_projects <- df %>%
  count(project_name, sort = TRUE) %>%
  head(8) %>%
  pull(project_name)

scatter_df <- df %>%
  mutate(project_label = ifelse(project_name %in% top_projects, project_name, "other"))

dark_bg <- "#0d1117"
grid_color <- "#21262d"
text_color <- "#c9d1d9"
accent <- "#58a6ff"
band_fill <- "#1f6feb33"
annotation_color <- "#f0883e"

project_colors <- c(
  "rusty-bloomnet" = "#58a6ff",
  "jobs-apply" = "#f78166",
  "skl-audit" = "#d2a8ff",
  "rusty-dakka" = "#7ee787",
  "misc (Documents)" = "#79c0ff",
  "oil" = "#ffa657",
  "public-lab" = "#ff7b72",
  "rusty-bloomnet--worktrees-stella-hooks" = "#a5d6ff",
  "other" = "#484f5866"
)

p <- ggplot() +
  geom_ribbon(
    data = weekly,
    aes(x = week_date, ymin = lower, ymax = upper),
    fill = band_fill
  ) +
  geom_point(
    data = scatter_df,
    aes(x = date, y = sentiment_raw, color = project_label),
    alpha = 0.12, size = 0.8
  ) +
  geom_line(
    data = weekly,
    aes(x = week_date, y = avg_sentiment),
    color = accent, linewidth = 1.2
  ) +
  geom_point(
    data = weekly,
    aes(x = week_date, y = avg_sentiment),
    color = accent, size = 2.5
  ) +
  geom_segment(
    data = milestones,
    aes(x = date, xend = date, y = 0, yend = y_offset),
    color = annotation_color, linetype = "dashed", linewidth = 0.4
  ) +
  geom_label(
    data = milestones,
    aes(x = date, y = y_offset, label = label),
    color = annotation_color, fill = dark_bg,
    size = 3, label.size = 0.3, label.padding = unit(0.2, "lines")
  ) +
  scale_color_manual(values = project_colors, name = "Project") +
  scale_y_continuous(
    breaks = seq(0, 10, 2),
    limits = c(0, 10)
  ) +
  labs(
    title = "Weekly Sentiment Trend: 2,740 Sessions Over 13 Weeks",
    subtitle = "Higher = calmer. Frustration decreases as quality tooling matures.",
    x = NULL,
    y = "Avg Keyword Sentiment"
  ) +
  theme_minimal(base_size = 13) +
  theme(
    plot.background = element_rect(fill = dark_bg, color = NA),
    panel.background = element_rect(fill = dark_bg, color = NA),
    panel.grid.major = element_line(color = grid_color, linewidth = 0.3),
    panel.grid.minor = element_blank(),
    text = element_text(color = text_color),
    axis.text = element_text(color = text_color),
    plot.title = element_text(color = "#f0f6fc", face = "bold", size = 15),
    plot.subtitle = element_text(color = text_color, size = 11),
    legend.background = element_rect(fill = dark_bg, color = NA),
    legend.key = element_rect(fill = dark_bg, color = NA),
    legend.text = element_text(color = text_color, size = 9),
    legend.title = element_text(color = text_color, size = 10),
    legend.position = "bottom",
    legend.direction = "horizontal"
  ) +
  guides(color = guide_legend(nrow = 1, override.aes = list(alpha = 1, size = 3)))

ggsave(out_path, p, width = 12, height = 6, dpi = 150, bg = dark_bg)
cat("Saved to", out_path, "\n")
