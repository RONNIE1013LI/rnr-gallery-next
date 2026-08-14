# Homepage Gallery Integration Design

## Approved direction

The Homepage V3 gallery mosaic reads five approved active Design Gallery records and presents four product formats: two Canvas designs, one Wall Banner, one Roll-up Banner and one Grave Cover.

## Data flow

The homepage server requests the five approved design IDs through the public gallery service. The service keeps only active records with available source images and returns them in the curated order. The selected records are passed into `HomepageV3` and rendered with the existing `/gallery-images/:id` route.

## Interaction

Each artwork links directly to its existing product configurator with the selected design ID. Product links open matching Design Gallery product filters. Images are always scaled at their source aspect ratio and never cropped. Column widths and gaps create the puzzle composition without image mats or expanded backgrounds. A restrained product-format label appears at the top-left of every image. If an approved design is unavailable, its tile is omitted rather than replaced by invented imagery.

## Constraints

- Preserve the approved Homepage V3 composition and responsive behaviour.
- Do not change the gallery database, admin, product, pricing or checkout logic.
- Do not duplicate image storage or create placeholder assets.
- Do not commit changes.
