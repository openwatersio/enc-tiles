ENC_DIR := data/ENC_ROOT
TILES_DIR := tiles
GPKG_DIR := $(TILES_DIR)/gpkg
ENC := $(wildcard $(ENC_DIR)/**/*.000)
GPKGS := $(patsubst $(ENC_DIR)/%.000,$(GPKG_DIR)/%.gpkg,$(ENC))

.PHONY: all clean data gpkg tiles

# Pipeline: S57 → individual GPKGs (parallel) → merged GPKG → quilted PMTiles
all: $(TILES_DIR)/noaa.pmtiles

# Step 1: Convert each S57 chart to its own GeoPackage (parallelizable with make -j)
$(GPKG_DIR)/%.gpkg: $(ENC_DIR)/%.000
	bin/s57-to-gpkg $< $@

# Step 2: Merge all individual GPKGs into one
gpkg: $(TILES_DIR)/noaa.gpkg

$(TILES_DIR)/noaa.gpkg: $(GPKGS)
	bin/merge-gpkg $@ $^

# Step 3: Generate PMTiles from the merged GeoPackage
tiles: $(TILES_DIR)/noaa.pmtiles

$(TILES_DIR)/noaa.pmtiles: $(TILES_DIR)/noaa.gpkg
	bin/gpkg-to-tiles $< $@

# Download NOAA ENC data
data:
	@mkdir -p data
	@echo "Downloading NOAA ENC data..."
	curl -L -o data/ALL_ENCs.zip https://charts.noaa.gov/ENCs/All_ENCs.zip
	@echo "Extracting ENC data..."
	unzip -o data/ALL_ENCs.zip -d data

clean:
	rm -rf $(TILES_DIR)
