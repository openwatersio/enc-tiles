ENC_DIR := data/ENC_ROOT
TILES_DIR := tiles
ENC := $(wildcard $(ENC_DIR)/**/*.000)
PMTILES := $(patsubst $(ENC_DIR)/%.000,$(TILES_DIR)/%.pmtiles,$(ENC))

.PHONY: all clean data tiles

# Pipeline: S57 → individual PMTiles (parallel) → merged PMTiles
all: $(TILES_DIR)/noaa.pmtiles

# Step 1: Convert each S57 chart to PMTiles (parallelizable with make -j)
$(TILES_DIR)/%.pmtiles: $(ENC_DIR)/%.000
	bin/s57-to-tiles $< $@

# Step 2: Merge all individual PMTiles into one
tiles: $(TILES_DIR)/noaa.pmtiles

$(TILES_DIR)/noaa.pmtiles: $(PMTILES)
	tile-join -f -o $@ $^

# Download NOAA ENC data
data:
	@mkdir -p data
	@echo "Downloading NOAA ENC data..."
	curl -L -o data/ALL_ENCs.zip https://charts.noaa.gov/ENCs/All_ENCs.zip
	@echo "Extracting ENC data..."
	unzip -o data/ALL_ENCs.zip -d data

clean:
	rm -rf $(TILES_DIR)
